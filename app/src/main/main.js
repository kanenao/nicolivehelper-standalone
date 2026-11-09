/*
 Copyright (c) 2017-2018 amano <amano@miku39.jp>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

var pname_whitelist = {};


var NicoLiveHelper = {
    liveProp: {},       ///< 生放送情報(ニコ生から取得する)

    connecttime: 0,     ///< 生放送への接続時刻
    nico_user_id: '',   ///< ニコニコ動画のユーザーID
    is_premium: 0,      ///< プレミアム会員かどうか

    live_begintime: 0,  ///< 放送開始時刻(UNIX時間)
    live_endtime: 0,    ///< 放送終了時刻(UNIX時間)
    /** @type {VideoInformation} */
    currentVideo: null, ///< 現在再生中の動画

    // コメント送信に必要な要素
    ticket: '',
    threadId: '',
    is_premium: 0,

    _autoplay_timer: null,  ///< 自動再生用タイマー
    _auto_enquete_timer: null,
    _auto_enquete_result_timer: null,
    _auto_enquete_state: null,
    _remain_timer_format_type: 0,   ///< 再生中動画の時間表示フォーマット種別(0:残り時間,1:経過時間,2:動作再生終了時の枠残り時間)

    _comm: null,                        ///< WebSocket通信インスタンス
    _seat_interval: null,               ///< 座席維持(keepSeat)送信インターバル
    _ws_reconnect_timer: null,          ///< 再接続タイマー
    _ws_reconnect_attempts: 0,          ///< 連続再接続試行回数
    _ws_is_intentional_close: false,    ///< 意図的な切断かどうかのフラグ
    _ws_audience_token: null,           ///< サーバーから受信した再接続用トークン
    _ws_is_reconnecting: false,         ///< 再接続処理実行中フラグ
    _active_comment_view_uri: null,     ///< 現在接続中のコメントサーバーURI
    _startup_comment_sent: false,       ///< 起動時コメント送信済みフラグ

    endpointUrl: "https://services-eapi.spi.nicovideo.jp",

    /**
     * 放送に接続しているかを返す.
     * @return {boolean}
     */
    isConnected: function(){
        return !!this.connecttime;
    },

    /**
     * 生主なら真を返す
     * @returns {boolean}
     */
    isCaster: function(){
        try{
            // 公式放送だと isOperator が存在していない
            // TODO 生主判定はどっち？
            // return !!this.liveProp.user.isOperator;
            return this.liveProp.user.isBroadcaster;
        }catch( e ){
            return true;
        }
    },

    /**
     * BSPを持っていたら真を返す
     * @returns {boolean}
     */
    hasBSP: function(){
        return false;
    },

    /**
     * プレイスタイルを返す.
     * 0: 手動
     * 1: 自動順次
     * 2: 自動ランダム
     * @returns {number}
     */
    getPlayStyle: function(){
        return parseInt( $( '#sel-playstyle' ).val() );
    },

    /**
     * リクエスト受付状態を返す
     * 0:受け付け
     * 1:不可
     * @returns {number}
     */
    getRequestAllowedStatus: function(){
        return parseInt( $( '#sel-allow-request' ).val() );
    },

    /**
     * 生放送タイトルを返す
     * @returns {String}
     */
    getLiveTitle: function(){
        try{
            return this.liveProp.program.title;
        }catch( e ){
            return '';
        }
    },

    /**
     * 生放送のIDを返す
     * @returns {String}
     */
    getLiveId: function(){
        try{
            return this.liveProp.program.nicoliveProgramId;
        }catch( e ){
            return '';
        }
    },

    /**
     * 放送しているコミュニティIDを返す
     * @returns {String|*}
     */
    getCommunityId: function(){
        try{
            return this.liveProp.community.id;
        }catch( e ){
            return null;
        }
    },

    /**
     * 動画再生時の音量設定を返す.
     * @returns {number}
     */
    getVolume: function(){
        return $( '#volume-slider' ).slider( 'value' ) / 10;
    },

    /**
     * マイク音量の設定値を返す.
     * @returns {number}
     */
    getMicrophoneVolume: function(){
        return $( '#slider-microphone-volume' ).slider( 'value' ) / 10;
    },

    /**
     * 経過時間表示のバー長を設定する.
     * @param p パーセンテージ数
     */
    refreshBroadcastLivePage: function(){
        const view = document.getElementById('broadcast-live-webview');
        const liveId = this.getLiveId();
        const state = document.getElementById('broadcast-player-state');
        if(!view) return;
        if(!liveId){ if(state) state.textContent='番組に接続すると放送画面を表示します'; return; }
        const target = 'https://live.nicovideo.jp/watch/' + encodeURIComponent(liveId);
        if(state) state.textContent='放送画面を読み込み中…';
        try{
            // srcへの再代入は同じURLでも再読み込みになる。ロード中の古い遷移は停止してから更新する。
            if(typeof view.isLoading === 'function' && view.isLoading() && typeof view.stop === 'function'){
                view.stop();
            }
            view.src = target;
        }catch(e){
            console.error('[BroadcastView] Failed to refresh:', e);
            if(state) state.textContent='放送画面を更新できません: ' + String(e.message || e);
        }
    },

    updateBroadcastDashboard: function(){
        const format = (seconds) => {
            if(!Number.isFinite(seconds)) return '--:--';
            seconds=Math.max(0,Math.floor(seconds));
            const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
            return h>0 ? String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
        };
        const viewers=document.getElementById('broadcast-live-viewers');
        const comments=document.getElementById('broadcast-live-comment-count');
        const remaining=document.getElementById('broadcast-live-remaining');
        if(viewers){ const n=document.querySelector('#number-of-listeners'); viewers.textContent=n && n.textContent.trim() ? n.textContent.trim() : '取得待ち'; }
        if(comments){
            const received = (typeof NicoLiveComment !== 'undefined' && Array.isArray(NicoLiveComment.commentlog)) ? NicoLiveComment.commentlog.length : 0;
            comments.textContent=FormatCommas(received);
        }
        if(remaining) remaining.textContent=this.live_endtime ? format(this.live_endtime-GetCurrentTime()) : '--:--';
        const current=document.getElementById('broadcast-player-current');
        const duration=document.getElementById('broadcast-player-duration');
        const seek=document.getElementById('broadcast-player-seek');
        const state=document.getElementById('broadcast-player-state');
        const title=document.getElementById('broadcast-player-title');
        if(this.currentVideo){
            const elapsed=Math.max(0,GetCurrentTime()-(this.currentVideo.play_begin||GetCurrentTime()));
            const length=Math.max(0,Number(this.currentVideo.length_ms||0)/1000);
            if(current) current.textContent=format(elapsed);
            if(duration) duration.textContent=format(length);
            if(seek){ seek.max='1000'; seek.value=length>0?String(Math.min(1000,Math.round(elapsed/length*1000))):'0'; seek.disabled=true; }
            if(title) title.textContent=this.currentVideo.title||this.currentVideo.video_id||'再生中の動画なし';
            if(state) state.textContent='ニコヘルの再生情報と同期中';
        }else{
            if(current) current.textContent='00:00';
            if(duration) duration.textContent='--:--';
            if(seek){seek.value='0';seek.disabled=true;}
            if(title) title.textContent='再生中の動画はありません';
            if(state) state.textContent='動画の再生待ち';
        }
    },

    initBroadcastPlayerControls: function(){
        const refresh=document.getElementById('broadcast-live-refresh');
        const back=document.getElementById('broadcast-player-back');
        const toggle=document.getElementById('broadcast-player-toggle');
        const forward=document.getElementById('broadcast-player-forward');
        const speed=document.getElementById('broadcast-player-speed');
        const state=document.getElementById('broadcast-player-state');
        const view=document.getElementById('broadcast-live-webview');
        if(refresh && !refresh.dataset.bound){refresh.dataset.bound='1';refresh.addEventListener('click',()=>this.refreshBroadcastLivePage());}
        // NicoLiveの引用再生APIには一時停止・シーク・再生速度変更の操作口がないため、
        // 誤って視聴ページ内の別動画を操作しないよう、現在の引用動画の時間表示だけを同期する。
        for(const button of [back,toggle,forward]) if(button){button.disabled=true;button.title='ニコ生の引用再生側に操作APIがないため未対応です';}
        if(speed){speed.disabled=true;speed.title='ニコ生の引用再生側に速度変更APIがないため未対応です';}
        if(state) state.textContent='ニコヘルの再生情報と同期します';
        if(view && !view.dataset.broadcastEventsBound){
            view.dataset.broadcastEventsBound='1';
            view.addEventListener('did-start-loading',()=>{
                if(state) state.textContent='放送画面を読み込み中…';
            });
            view.addEventListener('did-fail-load',(event,code,description,validatedURL,isMainFrame)=>{
                if(code!==-3 && isMainFrame && state) state.textContent='放送画面の読み込みに失敗: '+description+' ('+code+')';
                if(code!==-3 && isMainFrame) console.error('[BroadcastView] did-fail-load',code,description,validatedURL);
            });
            view.addEventListener('did-finish-load',()=>{
                if(state) state.textContent='ニコ生の放送画面を読み込みました';
            });
        }
        this.updateBroadcastDashboard();
    },

    setProgressMain: function( p ){
        $( '#progressbar-main' ).width( p + "%" );
    },

    /**
     * 自動再生のインジケータ表示を設定する.
     * @param flg
     */
    /**
     * アンケート実施中インジケータを設定する.
     * @param flg
     */
    setEnqueteIndicator: function( flg ){
        $( '#status-enquete' ).toggle( !!flg );
    },

    setAutoplayIndicator: function( flg ){
        if( flg ){
            $( '#status-autoplay' ).addClass( 'autoplaying' );
        }else{
            $( '#status-autoplay' ).removeClass( 'autoplaying' );
        }
    },


    /**
     * ニコ生アンケートを開始する.
     */
    enquete: async function( question, ...items ){
        if( !question || items.length < 2 || !this.isConnected() || !this.isCaster() ) return false;
        const url = `https://live2.nicovideo.jp/unama/watch/${this.getLiveId()}/enquete`;
        try{
            const res = await fetch( url, {
                method: 'POST',
                headers: {
                    'Content-type': 'application/json;charset=utf-8',
                    'X-Public-Api-Token': this.liveProp.site.relive.csrfToken
                },
                body: JSON.stringify({ question, items: items.filter( v => !!v ) })
            } );
            if( !res.ok ){
                console.error( '[AutoEnquete] start failed:', res.status, await res.text() );
                return false;
            }
            return true;
        }catch( e ){
            console.error( '[AutoEnquete] start error:', e );
            return false;
        }
    },

    enqueteShowResult: async function(){
        const url = `https://live2.nicovideo.jp/unama/watch/${this.getLiveId()}/enquete/result`;
        try{
            const res = await fetch( url, {
                method: 'POST',
                headers: {'X-Public-Api-Token': this.liveProp.site.relive.csrfToken}
            } );
            if( !res.ok ){
                console.error( '[AutoEnquete] fetch result failed:', res.status, await res.text() );
                return null;
            }
            const payload = await res.json();
            const items = payload && payload.data && payload.data.items;
            if( !Array.isArray( items ) ){
                console.error( '[AutoEnquete] unexpected result response:', payload );
                return null;
            }
            console.log( '[AutoEnquete] APIから投票結果を取得しました', items );
            return items;
        }catch( e ){
            console.error( '[AutoEnquete] fetch result error:', e );
            return null;
        }
    },

    enqueteEnd: async function(){
        const url = `https://live2.nicovideo.jp/unama/watch/${this.getLiveId()}/enquete`;
        try{
            const res = await fetch( url, {
                method: 'DELETE',
                headers: {'X-Public-Api-Token': this.liveProp.site.relive.csrfToken}
            } );
            if( !res.ok ) console.error( '[AutoEnquete] end failed:', res.status, await res.text() );
            return res.ok;
        }catch( e ){
            console.error( '[AutoEnquete] end error:', e );
            return false;
        }
    },

    clearAutoEnqueteTimers: function(){
        clearTimeout( this._auto_enquete_timer );
        clearTimeout( this._auto_enquete_result_timer );
        this._auto_enquete_timer = null;
        this._auto_enquete_result_timer = null;
        this._auto_enquete_state = null;
        this.setEnqueteIndicator( false );
    },

    scheduleAutoEnquete: function(){
        const currentVideoId = this.currentVideo ? this.currentVideo.video_id : null;
        clearTimeout( this._auto_enquete_timer );
        clearTimeout( this._auto_enquete_result_timer );
        this._auto_enquete_timer = null;
        this._auto_enquete_result_timer = null;
        this._auto_enquete_state = null;
        if( !Config['auto-enquete-enabled'] || !this.currentVideo || !this.isConnected() || !this.isCaster() ) return;
        const delay = Math.max( 0, parseInt( Config['auto-enquete-delay'] ) || 0 );
        const elapsed = Math.max( 0, GetCurrentTime() - (this.currentVideo.play_begin || GetCurrentTime()) );
        const wait = Math.max( 0, delay - elapsed );
        this._auto_enquete_timer = setTimeout( () => {
            if( !this.currentVideo || this.currentVideo.video_id !== currentVideoId ) return;
            this.startAutoEnquete();
        }, wait * 1000 );
        console.log( `[AutoEnquete] ${wait}秒後にアンケートを開始します` );
    },

    startAutoEnquete: async function(){
        if( this._auto_enquete_state || !Config['auto-enquete-enabled'] || !this.currentVideo ) return;
        this._auto_enquete_state = { video_id: this.currentVideo.video_id, round: 0, awaitingResult: false, finalizing: false };
        await this.runAutoEnqueteRound();
    },

    runAutoEnqueteRound: async function(){
        const state = this._auto_enquete_state;
        if( !state || !this.currentVideo || state.video_id !== this.currentVideo.video_id ) return;
        state.round++;
        state.awaitingResult = false;
        state.finalizing = false;
        const started = await this.enquete( 'この動画を続けるか、次の動画へ進むか投票してください', 'この動画を続ける', '次の動画へ' );
        if( !started ){
            this.showAlert( '自動アンケートを開始できませんでした。ログイン状態と配信主権限を確認してください。' );
            this._auto_enquete_state = null;
            this.setEnqueteIndicator( false );
            return;
        }
        this.setEnqueteIndicator( true );
        const duration = Math.max( 5, parseInt( Config['auto-enquete-duration'] ) || 30 );
        this._auto_enquete_timer = setTimeout( async () => {
            if( this._auto_enquete_state !== state ) return;
            state.awaitingResult = true;
            const items = await this.enqueteShowResult();
            if( this._auto_enquete_state !== state || state.finalizing ) return;
            if( !items ){
                await this.enqueteEnd();
                this._auto_enquete_state = null;
                this.setEnqueteIndicator( false );
                this.showAlert( 'アンケート結果をAPIから取得できませんでした。自動スキップは行いません。' );
                return;
            }
            const counts = {};
            for( const item of items ){
                if( item && typeof item.name === 'string' && Number.isFinite( Number(item.rate) ) ){
                    counts[item.name] = Number(item.rate);
                }
            }
            if( counts['この動画を続ける'] === undefined || counts['次の動画へ'] === undefined ){
                console.error( '[AutoEnquete] 必要な選択肢が結果にありません:', items );
                await this.enqueteEnd();
                this._auto_enquete_state = null;
                this.setEnqueteIndicator( false );
                this.showAlert( 'アンケート結果の選択肢を判定できませんでした。自動スキップは行いません。' );
                return;
            }
            if( this._auto_enquete_state !== state || state.finalizing ) return;
            state.finalizing = true;
            await this.finishAutoEnqueteRound( counts );
        }, duration * 1000 );
    },

    handleAutoEnqueteResult: function( chat ){
        const state = this._auto_enquete_state;
        if( !state || !state.awaitingResult || state.finalizing || !chat ) return;
        const text = chat.text_notag || chat.text || '';
        const counts = {};
        const re = /(この動画を続ける|次の動画へ)\\s*[（(：:]?\\s*(\\d+(?:\\.\\d+)?)\\s*%/g;
        let match;
        while( (match = re.exec( text )) !== null ){
            counts[match[1]] = parseFloat( match[2] );
        }
        if( counts['この動画を続ける'] === undefined || counts['次の動画へ'] === undefined ) return;
        state.finalizing = true;
        clearTimeout( this._auto_enquete_result_timer );
        this.finishAutoEnqueteRound( counts );
    },

    finishAutoEnqueteRound: async function( counts ){
        const state = this._auto_enquete_state;
        if( !state ) return;
        await this.enqueteEnd();
        this.setEnqueteIndicator( false );
        const keep = counts['この動画を続ける'];
        const skip = counts['次の動画へ'];
        const noVotes = keep === 0 && skip === 0;
        const tie = keep === skip;

        // 旧ルール：「この動画を続ける」が最多でも再投票・再生延長はしない。
        // 再投票するのは、設定で有効にされた同票または無投票の場合だけ。
        const repeat = (noVotes && Config['auto-enquete-repeat-empty']) ||
            (tie && !noVotes && Config['auto-enquete-repeat-tie']);
        if( repeat ){
            console.log( '[AutoEnquete] 同票または無投票のため再投票します', counts );
            this._auto_enquete_timer = setTimeout( () => this.runAutoEnqueteRound(), 2000 );
            return;
        }

        this._auto_enquete_state = null;
        if( Config['auto-enquete-auto-skip'] && skip > keep ){
            console.log( '[AutoEnquete] 次の動画へ進みます', counts );
            this.playNext();
        }else{
            // 元の動画終了タイマーは変更せず、自然に終了させる。
            console.log( '[AutoEnquete] 現在の動画を続けます', counts );
        }
    },

    pingCommentServer: function(){
        let ping = [
            {"ping": {"content": "rs:0"}}, {"ping": {"content": "ps:0"}},
            {"ping": {"content": "pf:0"}}, {"ping": {"content": "rf:0"}}];
        this._comment_svr.send( JSON.stringify( ping ) );
    },

    /**
     * 再生中動画のボリューム変更をする.
     * スライダーを動かすたびにリクエストするとエラーになるので
     * 2秒の猶予を持って実行する。
     */
    changeVolume: function(){
        if( this.currentVideo ){
            clearTimeout( this._change_volume_timer );
            // TODO やり方が変わったがXHRやWebsocketの通信ではないので調べられず方法不明
        }
    },

    /**
     * 動画情報をコメント
     * @param vinfo{VideoInformation}
     * @returns {Promise<void>}
     */
    sendVideoInfo: async function( vinfo ){
        let vinfo_command = [
            "vinfo-command-1",
            "vinfo-command-2",
            "vinfo-command-3",
            "vinfo-command-4"
        ];
        let vinfo_comment = [
            "vinfo-comment-1",
            "vinfo-comment-2",
            "vinfo-comment-3",
            "vinfo-comment-4"
        ];

        for( let i = 0; i < vinfo_comment.length; i++ ){
            let cmd = Config[vinfo_command[i]] || '';
            let txt = Config[vinfo_comment[i]] || '';
            if( !txt ) break;
            this.postCasterComment( txt, cmd, '', false );
            await Wait( Config['videoinfo-interval'] * 1000 );
        }
    },

    saveActivePlaySession: function( data ){
        try {
            localStorage.setItem( 'nicolivehelper_active_play_session', JSON.stringify( data ) );
        } catch( e ){
            console.warn( 'Failed to save active play session:', e );
        }
    },

    getActivePlaySession: function(){
        try {
            let item = localStorage.getItem( 'nicolivehelper_active_play_session' );
            return item ? JSON.parse( item ) : null;
        } catch( e ){
            console.warn( 'Failed to get active play session:', e );
            return null;
        }
    },

    clearActivePlaySession: function(){
        try {
            localStorage.removeItem( 'nicolivehelper_active_play_session' );
        } catch( e ){
            console.warn( 'Failed to clear active play session:', e );
        }
    },

    /**
     * 動画再生を停止する.
     * @returns {Promise<any>}
     */
    stopVideo: function(){
        let p = new Promise( ( resolve, reject ) => {
            if( !this.isConnected() || !this.isCaster() ){
                reject( null );
                return;
            }

            let url = `${this.endpointUrl}/v1/tools/live/contents/${this.getLiveId()}/quotation`;
            let xhr = CreateXHR( 'DELETE', url );
            let video_id = this.currentVideo.video_id;
            // Referer付かないけど大丈夫みたい
            xhr.onreadystatechange = () => {
                if( xhr.readyState != 4 ) return;
                if( xhr.status != 200 ){
                    // TODO エラー処理を更新する
                    console.log( `${xhr.status} ${xhr.responseText}` );

                    // 400 {"meta":{"status":400,"errorCode":"BAD_REQUEST","errorMessage":"引用再生できない動画です"}}
                    let err = JSON.parse( xhr.responseText );
                    this.showAlert( `${err.meta.errorMessage}` );
                    //this.currentVideo = null;
                    reject( err );
                    return;
                }
                this.currentVideo = null;
                this.clearActivePlaySession();
                this.setProgressMain( 0 );
                this.setAutoplayIndicator( false );
                clearTimeout( this._autoplay_timer );
                this._autoplay_timer = null;
                this.clearAutoEnqueteTimers();
                resolve( true );
            };
            xhr.send( '{}' );
        } );
        return p;
    },

    /**
     * 次の動画を再生するタイマーを設定する.
     * @param next 秒数
     */
    setNextPlayTimer: function( next ){
        clearTimeout( this._autoplay_timer );

        // 次動画再生タイマーをセットする.
        this._autoplay_timer = setTimeout( () => {
            if( this.getPlayStyle() != 0 ){
                // タイマーが発火したときに自動再生であれば次を再生する.
                this.playNext();
            }else{
                // 手動再生設定なので自動再生はなし
                this.setAutoplayIndicator( false );
                clearTimeout( this._autoplay_timer );
                this._autoplay_timer = null;
            }
        }, next * 1000 );

        console.log( `次動画再生: ${parseInt( next )}秒後` );

        if( this.getPlayStyle() != 0 ){
            this.setAutoplayIndicator( true );
        }else{
            this.setAutoplayIndicator( false );
        }
    },

    /**
     * 動画IDを直接指定して動画を再生する.
     * @param video_id
     * @returns {Promise<void>}
     */
    playVideoDirect: async function( video_id ){
        try{
            let vinfo = await this.getVideoInfo( video_id );
            this.playVideo( vinfo );
        }catch( e ){
            this.showAlert( `${video_id} を再生できませんでした` );
        }
    },

    /**
     * 動画を再生する.
     * 動画再生に成功したら自動的に動画情報コメント送信が行われる。
     * @param vinfo{VideoInformation} 再生したい動画情報
     * @param is_change_volume trueだとボリューム変更
     * @returns {Promise<any>}
     */
    playVideo: async function( vinfo, is_change_volume ){
        // 現在再生中の動画を取得
        let current = await HttpGet( `${this.endpointUrl}/v1/tools/live/contents/${this.getLiveId()}/quotation` );

        // 次動画の再生したあとに音量変更が走ると困るのでタイマーを取り消す
        clearTimeout( this._change_volume_timer );
        let p = new Promise( ( resolve, reject ) => {
            if( !this.isConnected() || !this.isCaster() ){
                reject( null );
                return;
            }
            if( GetCurrentTime() >= this.live_endtime ){
                this.showAlert( `放送終了時刻を過ぎたため再生できません` );
                reject( null );
                return null;
            }

            let video_id = vinfo.video_id;
            let newplay_url = `${this.endpointUrl}/v1/tools/live/contents/${this.getLiveId()}/quotation`;
            let changeurl = `${this.endpointUrl}/v1/tools/live/contents/${this.getLiveId()}/quotation/contents`;
            let newplay = current.status === 404;

            let xhr;
            if( newplay ){
                xhr = CreateXHR( 'POST', newplay_url );
            }else{
                xhr = CreateXHR( 'PATCH', changeurl );
            }
            xhr.setRequestHeader( 'Content-type', 'application/json' );
            xhr.onreadystatechange = () => {
                if( xhr.readyState != 4 ) return;
                if( xhr.status != 200 ){
                    console.log( `${xhr.status} ${xhr.responseText}` );

                    // 400 {"meta":{"status":400,"errorCode":"BAD_REQUEST","errorMessage":"引用再生できない動画です"}}
                    try{
                        let err = JSON.parse( xhr.responseText );
                        this.showAlert( `${vinfo.video_id}: ${err.meta.errorMessage}` );
                        //this.currentVideo = null;
                        reject( err );
                    }catch( e ){
                        this.showAlert( `${vinfo.video_id}の再生に失敗しました` );
                        reject( null );
                    }
                    return;
                }
                this.currentVideo = CopyObject( vinfo );
                if( !is_change_volume ){
                    // 再生成功したら、再生履歴に記録する
                    NicoLiveHistory.addHistory( vinfo );
                    this.sendVideoInfo( vinfo );

                    let now = GetCurrentTime();
                    this.currentVideo.play_begin = now;
                    this.currentVideo.play_end = now + parseInt( this.currentVideo.length_ms / 1000 );

                    this.saveActivePlaySession({
                        live_id: this.getLiveId(),
                        video_id: vinfo.video_id,
                        title: vinfo.title,
                        length_ms: this.currentVideo.length_ms,
                        play_begin: this.currentVideo.play_begin,
                        play_end: this.currentVideo.play_end,
                    });

                    let next = parseInt( this.currentVideo.length_ms / 1000 + Config['autoplay-interval'] );
                    this.setNextPlayTimer( next );
                    this.scheduleAutoEnquete();

                    if( typeof Discord !== 'undefined' && Config['discord-on-play'] && Discord.webhookUrl ){
                        let str = this.replaceMacros( Config['discord-text'], this.currentVideo );
                        Discord.updateStatus( str );
                    }
                }
                resolve( true );
            };

            let volume = this.getVolume();
            let micvolume = this.getMicrophoneVolume();
            let data = {
                'contents': [
                    {
                        'id': video_id,
                        'type': 'video'
                    }
                ]
            };
            if( newplay ){
                data['layout'] = {
                    'main': {
                        'source': 'quote',
                        'volume': volume
                    },
                    'sub': {
                        'isSoundOnly': true,
                        'source': 'self',
                        'volume': micvolume
                    }
                };
                data['repeat'] = false;
                data['enableAddViewCount'] = true;
            }
            xhr.send( JSON.stringify( data ) );
        } );
        return p;
    },

    /**
     * 次の動画を再生する.
     */
    playNext: async function(){
        if( this._lock ){
            console.log( '次の動画の再生処理中です' );
            this.showAlert( '次の動画の再生待機中です' );
            return;
        }
        this._lock = true;
        try{
            await this._playNext();
        }catch( e ){
        }
        this._lock = false;
    },

    _playNext: async function(){

        let request = NicoLiveRequest.request;
        let stock = NicoLiveStock.stock;
        let ps = this.getPlayStyle();
        let is_random = document.querySelector( '#play-stock-random' ).checked;

        let ridx = request.map( ( v, i ) => {
            return i;
        } );
        let sidx = stock.map( ( v, i ) => {
            return i;
        } );

        if( ps == 2 ){
            ShuffleArray( ridx );
        }
        if( ps == 2 || is_random ){
            ShuffleArray( sidx );
        }

        for( let i = 0; i < ridx.length; i++ ){
            let vinfo = request[ridx[i]];
            if( vinfo.no_live_play == 0 ){
                if( Config['play-in-time'] ){
                    let remain = (this.live_endtime - GetCurrentTime()) * 1000;
                    if( vinfo.length_ms > remain ) continue;
                }
                let result = await NicoLiveRequest.playVideo( ridx[i] );
                if( result ) return;
                await Wait( 2500 );
            }
        }
        for( let i = 0; i < sidx.length; i++ ){
            let vinfo = stock[sidx[i]];
            if( vinfo.no_live_play == 0 && !vinfo.is_played ){
                if( Config['play-in-time'] ){
                    let remain = (this.live_endtime - GetCurrentTime()) * 1000;
                    if( vinfo.length_ms > remain ) continue;
                }
                let result = await NicoLiveStock.playVideo( sidx[i] );
                if( result ) return;
                await Wait( 2500 );
            }
        }

        this.showAlert( `再生できる動画がありませんでした` );
        this.setAutoplayIndicator( false );
    },

    /**
     * 現在再生している動画IDを返す.
     * mixingを叩くので生主専用。
     * @returns {Promise<any>}
     */
    getCurrentVideo: async function(){
        let current = await HttpGet( `https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/${this.getLiveId()}/quotation` );
        if( current.status !== 404 ){
            let contents = JSON.parse( current.responseText );
            console.log( contents );
            return contents.currentContent?.id;
        }
        return '';
    },

    /**
     * 自動引用再生を開始する。
     */
    autoStartQuote: async function(){
        console.log( 'autoStartQuote: start', {
            enabled: Config['auto-start-quote'],
            isCaster: this.isCaster(),
            requestCount: NicoLiveRequest.request.length,
            stockCount: NicoLiveStock.stock.length
        } );
        if( !Config['auto-start-quote'] ){
            console.log( 'autoStartQuote: disabled by config' );
            return;
        }
        if( !this.isCaster() ){
            console.log( 'autoStartQuote: canceled because not caster' );
            return;
        }

        try{
            let current = await HttpGet( `${this.endpointUrl}/v1/tools/live/contents/${this.getLiveId()}/quotation` );
            console.log( 'autoStartQuote: current quote status', current );
            if( current.status !== 404 ){
                // 500などのサーバーエラーの場合は再試行をスキップ
                if( current.status >= 500 ){
                    console.log( 'autoStartQuote: server error, skipping auto start', current.status );
                    return;
                }
                console.log( 'autoStartQuote: quote already active or returned unexpected status', current.status );
                return;
            }
        }catch( e ){
            console.log( 'autoStartQuote: failed to get current quote status', e );
            return;
        }

        if( NicoLiveRequest.request.length === 0 && NicoLiveStock.stock.length === 0 ){
            console.log( 'autoStartQuote: no queued request or stock video available' );
            return;
        }

        console.log( 'autoStartQuote: invoking playNext' );
        this.playNext();
    },

    /**
     * プログレスバーの表示を初期状態にする.
     * @returns {Promise<void>}
     */
    initProgressBar: async function(){
        let video_id = await this.getCurrentVideo();
        console.log( `Current video: ${video_id}` );
        if( !video_id ){
            this.clearActivePlaySession();
            return;
        }

        let vinfo = await this.getVideoInfo( video_id );
        this.currentVideo = vinfo;

        let now = GetCurrentTime();
        let session = this.getActivePlaySession();

        // 直前にアプリで再生しており、同じ配信枠かつ同じ動画で、まだ終了予定時刻を過ぎていない場合は正確な再生時間を復元
        if( session && session.live_id === this.getLiveId() && session.video_id === video_id && now < session.play_end ){
            console.log( '[STSen] Restored active play session from storage:', session );
            this.currentVideo.play_begin = session.play_begin;
            this.currentVideo.play_end = session.play_end;

            // 残り時間に合わせて次の動画の自動再生タイマーを再スケジュール
            let remainingSec = session.play_end - now;
            let next = parseInt( remainingSec + (Config['autoplay-interval'] || 10) );
            if( next > 0 ){
                this.setNextPlayTimer( next );
            }
        } else {
            // 保存セッションがない場合は現在の時刻を開始とし、動画の長さから終了予定時刻を設定
            this.currentVideo.play_begin = now;
            this.currentVideo.play_end = now + parseInt( (vinfo.length_ms || 0) / 1000 );
        }

        this.scheduleAutoEnquete();
        $( '#remaining-time-main' ).text( vinfo.title );
        this.updateVideoProgress( now );
        this.updateBroadcastDashboard();
    },


    /**
     * スタートアップコメント（配信開始時の挨拶）を送信する.
     * @returns {Promise<void>}
     */
    sendStartupComment: async function(){
        if( !Config['startup-comment-enabled'] ) return;
        if( !this.isCaster() ) return;
        if( this._startup_comment_sent ) return;

        // 放送開始からの経過秒数チェック（枠の途中から接続・再接続した際の誤爆防止）
        let liveprogress = GetCurrentTime() - this.live_begintime;
        let expireSec = parseInt( Config['startup-comment-expire-seconds'] ) || 180;
        if( this.live_begintime && liveprogress > expireSec ){
            console.log( `[StartupComment] 放送開始から ${liveprogress}秒 経過しているため、挨拶送信をスキップします (上限: ${expireSec}秒)` );
            return;
        }

        let rawText = Config['startup-comment-text'];
        if( !rawText || !rawText.trim() ) return;

        // 多重送信防止フラグを直ちに立てる
        this._startup_comment_sent = true;

        console.log( '[StartupComment] スタートアップコメント送信シーケンスを開始します' );

        // 接続直後の待機ディレイ
        let delaySec = parseInt( Config['startup-comment-delay'] );
        if( isNaN( delaySec ) || delaySec < 0 ) delaySec = 3;
        if( delaySec > 0 ){
            console.log( `[StartupComment] 待機中 (${delaySec}秒)...` );
            await Wait( delaySec * 1000 );
        }

        let lines = rawText.split( /\r\n|\r|\n/ );
        let target = Config['startup-comment-target'] || 'caster';
        let command = Config['startup-comment-command'] || '';
        let intervalSec = parseInt( Config['startup-comment-interval'] );
        if( isNaN( intervalSec ) || intervalSec < 1 ) intervalSec = 5;

        for( let i = 0; i < lines.length; i++ ){
            let line = lines[i].trim();
            if( !line ) continue;

            // マクロ展開
            let text = this.replaceMacros( line, this.currentVideo || {} );

            try {
                if( target === 'listener' ){
                    console.log( `[StartupComment] 通常コメント送信 (${i + 1}/${lines.length}): ${text}` );
                    this.sendComment( command, text );
                } else {
                    console.log( `[StartupComment] 主コメ送信 (${i + 1}/${lines.length}): ${text}` );
                    this.postCasterComment( text, command, '', false );
                }
            } catch( err ) {
                console.error( '[StartupComment] コメント送信エラー:', err );
            }

            if( i < lines.length - 1 && intervalSec > 0 ){
                await Wait( intervalSec * 1000 );
            }
        }
        this.showAlert( '配信開始の挨拶コメントを送信しました' );
    },

    /**
     * 文字列のマクロ展開を行う.
     * @param str 置換元も文字列
     * @param info 動画情報
     */
    replaceMacros: function( str, info ){
        let replacefunc = function( s, p ){
            let tmp = s;
            let expression;
            if( expression = p.match( /^=(.*)/ ) ){
                try{
                    // TODO 式マクロを実装するかどうか
                    tmp = null; //eval( expression[1] );
                    if( tmp == undefined || tmp == null ) tmp = "";
                }catch( x ){
                    tmp = "";
                }
                return tmp;
            }
            switch( p ){
            default:
                if( p.match( /^reqstat:(.*?):(.*?)$/ ) ){
                    let msgs = [RegExp.$1, RegExp.$2];
                    tmp = msgs[NicoLiveHelper.getRequestAllowedStatus()];
                }
                break;
            case 'id':
                if( !info.video_id ) break;
                tmp = info.video_id;
                break;
            case 'title':
                if( !info.title ) break;
                tmp = info.title;
                break;
            case 'date':
                if( !info.first_retrieve ) break;
                tmp = GetDateString( info.first_retrieve * 1000, true );
                break;
            case 'length':
                if( !info.length ) break;
                tmp = info.length;
                break;
            case 'view':
                if( !info.view_counter && 'number' != typeof info.view_counter ) break;
                tmp = FormatCommas( info.view_counter );
                break;
            case 'comment':
                if( !info.comment_num && 'number' != typeof info.comment_num ) break;
                tmp = FormatCommas( info.comment_num );
                break;
            case 'mylist':
                if( !info.mylist_counter && 'number' != typeof info.mylist_counter ) break;
                tmp = FormatCommas( info.mylist_counter );
                break;
            case 'mylistrate':
                if( !info.mylist_counter && 'number' != typeof info.mylist_counter ) break;
                if( !info.view_counter && 'number' != typeof info.view_counter ) break;
                if( info.view_counter == 0 ){
                    tmp = "0.0%";
                }else{
                    tmp = (100 * info.mylist_counter / info.view_counter).toFixed( 1 ) + "%";
                }
                break;
            case 'tags':
                // 1行40文字程度までかなぁ
                if( !info.tags['jp'] ) break;
                tmp = info.tags['jp'].join( '　' );
                tmp = tmp.replace( /(.{35,}?)　/g, "$1<br>" );
                break;
            case 'username':
                // 動画の投稿者名
                tmp = info.user_nickname || "";
                break;
            case 'pname':
                // P名
                if( info.video_id == null || info.tags['jp'] == null ) break;
                tmp = NicoLiveHelper.getPName( info );
                break;
            case 'additional':
                // TODO 動画DBに登録してある追加情報
                break;
            case 'description':
                // 詳細を40文字まで(世界の新着と同じ)
                tmp = info.description.match( /.{1,40}/ );
                break;

            case 'comment_no':
                // リク主のコメント番号
                tmp = info.comment_no || 0;
                break;

            case 'requestnum': // リク残数.
                let remainrequest = 0;
                NicoLiveRequest.request.forEach( function( item ){
                    if( !item.is_played && !item.no_live_play ) remainrequest++;
                } );
                tmp = remainrequest;
                break;
            case 'requesttime': // リク残時間(hh:mm:ss).
                let reqtime = NicoLiveRequest.getRequestTime();
                tmp = GetTimeString( reqtime.min * 60 + reqtime.sec );
                break;
            case 'stocknum':  // ストック残数.
                let remainstock = 0;
                NicoLiveStock.stock.forEach( function( item ){
                    if( !item.is_played && !item.no_live_play ) remainstock++;
                } );
                tmp = remainstock;
                break;
            case 'stocktime': // ストック残時間(hh:mm:ss).
                let stocktime = NicoLiveStock.getStockTime();
                tmp = GetTimeString( stocktime.min * 60 + stocktime.sec );
                break;

            case 'mylistcomment':
                // マイリストコメント
                tmp = info.mylistcomment;
                if( !tmp ) tmp = "";
                break;

            case 'pref:min-ago':
                // TODO 枠終了 n 分前通知の設定値.
                tmp = Config.notice.time;
                break;

            case 'end-time':
                // 放送の終了時刻.
                tmp = GetDateString( NicoLiveHelper.live_endtime * 1000, true );
                break;

            case 'live-id':
                tmp = NicoLiveHelper.getLiveId();
                break;
            case 'live-title':
                tmp = NicoLiveHelper.liveProp.program.title;
                break;
            }
            return tmp;
        };
        // String.replace()だとネストが処理できないので自前で置換
        let r = "";
        let token = "";
        let nest = 0;
        for( let i = 0, ch; ch = str.charAt( i ); i++ ){
            switch( nest ){
            case 0:
                if( ch == '{' ){
                    nest++;
                    token += ch;
                    break;
                }
                r += ch;
                break;
            default:
                token += ch;
                if( ch == '{' ) nest++;
                if( ch == '}' ){
                    nest--;
                    if( nest <= 0 ){
                        try{
                            r += replacefunc( token, token.substring( 1, token.length - 1 ) );
                        }catch( x ){
                        }
                        token = "";
                    }
                }
                break;
            }
        }
        return r;
    },

    /**
     *  与えられたstrがP名かどうか.
     */
    isPName: function( str ){
        if( pname_whitelist["_" + str] ){
            return true;
        }

        // if( Config.no_auto_pname ) return false;
        if( str.match( /(PSP|アイドルマスターSP|m[a@]shup|drop|step|overlap|vocaloid_map|mikunopop|mikupop|ship|dump|sleep)$/i ) ) return false;
        if( str.match( /(M[A@]D|joysound|MMD|HD|2D|3D|4D|vocaloud|world|頭文字D|イニシャルD|(吸血鬼|バンパイア)ハンターD|TOD|oid|clannad|2nd|3rd|second|third|append|CD|DVD|solid|vivid|hard)$/i ) ) return false;
        let t = str.match( /.*([^jO][pP]|jP)[)]?$/ );
        if( t ){
            return true;
        }
        // D名
        t = str.match( /.*[^E][D]$/ );
        return !!t;
    },

    /**
     * P名を取得する
     */
    getPName: function( item ){
        // DBに設定してあるP名があればそれを優先.
        let pname = null;//Database.getPName(item.video_id);
        if( !pname ){
            pname = [];
            let i, j, tag;
            try{
                // まずはP名候補をリストアップ.
                for( i = 0; tag = item.tags['jp'][i]; i++ ){
                    if( this.isPName( tag ) ){
                        pname.push( tag );
                    }
                }
            }catch( x ){
            }
            if( pname.length ){
                /* ラマーズP,嫁に囲まれて本気出すラマーズP
                 * とあるときに、後者だけを出すようにフィルタ.
                 * てきとう実装.
                 * 組み合わせの問題なのでnlognで出来るけど、
                 * P名タグは数少ないしn*nでもいいよね.
                 */
                let n = pname.length;
                for( i = 0; i < n; i++ ){
                    let omitflg = false;
                    if( !pname[i] ) continue;
                    for( j = 0; j < n; j++ ){
                        if( i == j ) continue;

                        if( 0 && pname[j].match( pname[i] + '$' ) ){
                            omitflg = true;
                        }
                        /* 曲名(誰P)となっているものが含まれていたらそれを除外する
                         * ために (誰P) を含むものを除外する.
                         */
                        if( pname[j].indexOf( '(' + pname[i] + ')' ) != -1 ){
                            pname[j] = "";
                        }
                    }
                    if( omitflg ) pname[i] = "";
                }
                let tmp = new Array();
                for( i = 0; i < n; i++ ){
                    if( pname[i] ) tmp.push( pname[i] );
                }
                pname = tmp.join( ', ' );
            }else{
                pname = "";
            }
        }
        return pname;
    },

    /**
     * コメント送信待ち時間のミリ秒を返す.
     * コメント送信が短すぎると言われたときに何ミリ秒待機して再送信するかの時間を返す。
     * @param c エラー回数
     * @returns {number} 待機すべきミリ秒数
     */
    calcBackoffTime: function( c ){
        if( c > 5 ) c = 5;
        if( c <= 1 ) c = 2;
        let k = GetRandomInt( 1, Math.pow( 2, c ) - 1 );
        return 250 + k * 0.25 * 1000;
    },


    /**
     * 特殊コマンドの実行
     * @param text
     */
    commandComment: async function( text, mail, name ){
        let cmd = text.match( /^\/(\w+)\s+(.*)$/ );
        if( !cmd ) return;

        cmd = RegExp.$1;
        let body = RegExp.$2;

        switch( cmd ){
        case 'choice':
            let video_ids = body.split( /\s+/ );
            let choice = video_ids[GetRandomInt( 0, video_ids.length - 1 )];
            console.log( `play:${choice}` );
            if( choice.indexOf( 'db:' ) === 0 ){
                choice = await DB.choice( choice.substring( 3 ) );
                console.log( choice );
                if( !choice ){
                    return;
                }
                choice = choice.video_id;
            }
            this.playVideoDirect( choice );
            break;

        case 'perm':
            this.postCasterComment( body, mail, name, true );
            break;

        }
    },

    /**
     * 新配信で運営コメント送信をする.
     *
     * isPermコメントを消すには clearApiUrl に DELETE リクエストを送る
     *
     * @param text コメント
     * @param mail コマンド欄
     * @param name 名前
     * @param isPerm ずっと表示させる. true or false. 旧/permの役割
     * @param cnt リトライカウンター
     */
    postCasterComment: async function( text, mail, name, isPerm, cnt ){
        if( text == '' ) return;
        if( !this.isCaster() ) return;
        mail = mail || '';
        name = name || '';
        isPerm = !!isPerm;
        cnt = cnt || 0;

        if( text.indexOf( '/' ) == 0 ){
            this.commandComment( text, mail, name );
            return;
        }

        // let url = this.liveProp.program.broadcasterComment.postApiUrl;
        let url = `https://live2.nicovideo.jp/unama/api/v3/programs/${this.getLiveId()}/broadcaster_comment`;
        // TODO 現状主コメは80文字までなのでマクロ展開する余地があるかどうか
        text = this.replaceMacros( text, this.currentVideo );
        text = text.replace( /<br>/ig, "\n" );

        let xhr = CreateXHR( 'PUT', url );
        xhr.onreadystatechange = async () => {
            if( xhr.readyState != 4 ) return;
            if( xhr.status != 200 ){
                console.log( `${xhr.status} ${xhr.responseText}` );
                let error = JSON.parse( xhr.responseText );
                console.log( `コメント送信: ${error.meta.errorMessage || error.meta.errorCode}` );
                if( error.meta.errorMessage.match( /リクエスト間隔が短/ ) ){
                    let ms = this.calcBackoffTime( cnt + 1 );
                    console.log( `${ms}ミリ 秒待機します(${cnt + 1})` );
                    await Wait( ms );
                    this.postCasterComment( text, mail, name, isPerm, cnt + 1 );
                }else{
                    this.showAlert( `コメント送信: ${error.meta.errorMessage || error.meta.errorCode}` );
                }
                return;
            }
            console.log( `Comment posted: ${xhr.responseText}` );
        };

        xhr.setRequestHeader( 'X-Public-Api-Token', this.liveProp.site.relive.csrfToken );

        let form = new FormData();
        form.append( 'text', text );
        form.append( 'command', mail );
        form.append( 'name', name );
        form.append( 'isPermanent', isPerm );
        xhr.send( form );
    },

    /**
     * 視聴者コメントをする.
     * @param mail
     * @param text
     */
    sendComment: function( mail, text ){
        if( !text ) return;
        // JASRACコードの-を=に変換
        text = text.replace( /((...)[-](....)[-](.))/g, "$2=$3=$4" );
        text = text.replace( /<br>/ig, "\n" );

        let t = this.liveProp.program.vposBaseTime;
        let vpos = Math.floor( (GetCurrentTime() - t) * 100 );

        let color;
        let size;
        let position;

        color = mail.match( /(white2|red2|pink2|orange2|yellow2|green2|cyan2|blue2|purple2|black2|white|red|pink|orange|yellow|green|cyan|blue|purple|black|#[0-9A-Fa-f]+)/ ) || "white";
        size = mail.match( /(medium|big|small)/ ) || "medium";
        position = mail.match( /(ue|naka|shita)/ ) || "naka";
        if( Array.isArray( color ) ) color = color[0];
        if( Array.isArray( size ) ) size = size[0];
        if( Array.isArray( position ) ) position = position[0];
        let chat = {
            "type": "postComment",
            "data": {
                "text": text,
                "vpos": vpos,
                "color": color,
                "size": size,
                "position": position
            }
        };
        if( Config['comment-184'] ){
            chat.data.isAnonymous = true;
        }
        // コメントサーバーの方に送らず、こちらに a.live2 の方に送る
        this._comm.send( JSON.stringify( chat ) );
        // console.log( chat );
    },

    /**
     * 主コメを処理する.
     * @param chat{Comment}
     */
    processCasterComment: function( chat ){
        let text = chat.text_notag;
    },


    /**
     * 視聴者コメントを処理する.
     */
    processListenersComment: function( chat ){
        let text = chat.text_notag;

        if( text.match( /((sm|nm)\d+)/ ) ){
            let video_id = RegExp.$1;
            let is_self_request = !!text.match( /[^他](貼|張)|自|関/ );
            let code = "";
            // 作品コードの処理
            try{
                code = chat.text.match( /(...[-+=/]....[-+=/].)/ )[1];
                code = code.replace( /[-+=/]/g, "-" ); // JWID用作品コード.
            }catch( e ){
            }

            if( this.getRequestAllowedStatus() == 0 ){
                NicoLiveRequest.addRequest( video_id, chat.comment_no, chat.user_id, is_self_request, code, chat.name );
            }else{
                NicoLiveRequest.sendReply( 'request-not-allow',
                    {video_id: video_id, comment_no: chat.comment_no} );
            }
        }
        if( text.match( /(\d{10})/ ) ){
            // TODO 現状、新配信ではチャンネル動画は再生できない
            let video_id = RegExp.$1;
            if( video_id == "8888888888" ) return;
            let is_self_request = !!text.match( /[^他](貼|張)|自|関/ );
            let code = "";
            // NicoLiveRequest.addRequest( video_id, chat.comment_no, chat.user_id, is_self_request, code );
        }
    },



    /**
     * 受信したコメントを処理する.
     * @param chat{Comment}
     */
    processComment: async function( chat ){
        NicoLiveComment.addComment( chat );

        switch( chat.premium ){
        case 2: // チャンネル生放送の場合、こちらの場合もあり。
        case 3: // 運営コメント(/nicoad, /infoもこちら)
        case 7: // 運営コメントにnameパラメータ付けるとこれになる
            if( chat.text.match( /^\/disconnect/ ) ){
                this.showAlert( `放送が終了しました`, true );
                this.live_endtime = 0;
                clearTimeout( this._autoplay_timer );
                this._autoplay_timer = null;
                this.setAutoplayIndicator( false );

                if( this.isCaster() && Config['auto-create-next'] ){
                    // 次枠作成も手動操作と同じ専用ウィンドウで開き、NicoLive Helper 内で管理する。
                    try {
                        const result = await window.stsen.openNicoLiveCreate( this.getLiveId() );
            if( !result || result.success === false ) throw new Error( result && result.error || '次枠作成ページの読み込みに失敗しました' );
                    } catch( e ) {
                        console.error( '[Broadcast] 自動次枠作成画面を開けませんでした:', e );
                        this.showAlert( '次枠作成画面を開けませんでした。放送管理タブから再度お試しください。' );
                    }
                }

                if( Config['auto-close-livepage'] ){
                    let tabs = await browser.tabs.query( {url: 'https://*.nicovideo.jp/watch/lv*'} );
                    for( let tab of tabs ){
                        if( tab.url.indexOf( this.getLiveId() ) >= 0 ){
                            await browser.tabs.remove( tab.id )
                        }
                    }
                }

                if( Config['auto-close'] ){
                    window.close();
                }
            }
            if( chat.date < this.connecttime ) return;

            if( this.isCaster() ){
                this.handleAutoEnqueteResult( chat );
                return;
            }
            this.processCasterComment( chat );

            // コメント読み上げ
            if( Config['do-speech'] && Config['do-speech-caster-comment'] ){
                if( chat.date > this.connecttime ){
                    if( chat.text_notag.indexOf( '/' ) !== 0 ){
                        Talker.speech2(
                            chat.text_notag, Config['webspeech-select-voice'],
                            Config['webspeech-volume'], Config['webspeech-speed']
                        );
                    }
                }
            }
            break;

        case 1: // プレミアム会員
        case 0: // 一般会員
            // リスナーコメント
            // 接続時より前のコメントは反応しないようにする
            if( this.isCaster() && chat.date < this.connecttime ) return;
            this.processListenersComment( chat );
            NicoLiveComment.reflection( chat );

            // コメント読み上げ
            if( Config['do-speech'] ){
                if( chat.date > this.connecttime ){
                    Talker.speech2(
                        chat.text_notag, Config['webspeech-select-voice'],
                        Config['webspeech-volume'], Config['webspeech-speed']
                    );
                }
            }
            break;

        default:
            break;
        }
    },

    /**
     * コメントサーバーからコメントデータを受け取ったときの処理.
     * @param data
     */
    onCommentReceived: function( data ){
        console.log( data );    // TODO コメント受信したときのログ表示
        if( data.thread ){
            // data.thread.ticket;
            // data.thread.last_res;
            // data.thread.resultcode;
            this.ticket = data.thread.ticket;
            console.log( `ticket:${this.ticket}` );
        }

        if( data.chat ){
            let chat = data.chat;
            // 念のために従来のように値がなかった時のため
            chat.mail = chat.mail || "";
            chat.name = chat.name || "";
            chat.locale = chat.locale || "";
            chat.score = chat.score || 0;   // スコアは負の数
            chat.date = chat.date || 0;     // UNIX時間
            chat.premium = chat.premium || 0;
            chat.user_id = chat.user_id || "0";
            chat.anonymity = chat.anonymity || 0;
            chat.no = chat.no || 0;
            chat.comment_no = chat.no;
            chat.text = chat.content;

            chat.yourpost = chat.yourpost || 0; // 自分のコメントかどうかの1 or 0
            if( chat.user_id == this.nico_user_id ){
                // yourpostは過去ログには適用されないので自身で判断
                // ただし184だと識別できないのでユーザーIDが一致するときだけ。
                chat.yourpost = 1;
            }

            if( chat.premium == 3 || chat.premium == 2 ){
                // 主コメ
                chat.text_notag = chat.text.replace( /<.*?>/g, "" );
            }else{
                chat.text_notag = chat.text;
            }

            this.processComment( chat );
        }
    },


    // forward方向メッセージ受信して表示
    pull_messages: async function( uri ){
        const mType = protobuf.roots.default.dwango.nicolive.chat.service.edge.ChunkedMessage;
        for await( const msg of this.messageRetriever( uri, mType ) ){
            //表示想定時刻までsleepする
            if( msg.meta ){
                // do{
                //     await sleep_until( msg.meta.at );
                // }while( await g_pause );
            }
            console.log( msg );

            let op_message = msg?.state?.marquee?.display?.operatorComment?.content;
            let user_message = msg?.message?.chat;
            // {
            //     "content": "新馬戦の予想なんてどう組み立ててるんかな",
            //     "vpos": 1217767,
            //     "accountStatus": 1,
            //     "hashedUserId": "a:9W9yGj68Q_0swdPA",
            //     "modifier": {},
            //     "no": 333
            // }

            let chat = {
                premium: op_message ? 2 : 0,
                date: msg?.meta?.at?.seconds,
                text: op_message || user_message?.content || "",
                text_notag: op_message || user_message?.content || "",
                name: user_message?.name || "",
                user_id: user_message?.hashedUserId || msg?.meta?.id || "0",
                no: user_message?.no || 0,
                comment_no: user_message?.no || 0,
            };
            if( op_message || user_message ){
                this.processComment( chat );
            }
            console.log( `Op Comment: ${op_message}` );

            if( msg.state != null ){
                // update_state( msg );
            }
        }
    },

    connectCommentServer: async function( room ){
        const fwd = protobuf.roots.default.dwango.nicolive.chat.service.edge.ChunkedEntry;
        let next = GetCurrentTime() - 5 * 60;
        let init_phase = true;
        while( next ){
            const current_next = next;
            next = null;
            for await( const entry of this.messageRetriever( `${room.viewUri}?at=${current_next}`, fwd ) ){
                // console.log( "retrieve entry message:" );
                console.log( entry );

                if( entry.backward != null && init_phase ){
                    //previous以前の中で最新stateメッセージを取得
                    // await pull_messages(entry.backward.snapshot.uri);
                    console.log( "backward" );
                }else if( entry.previous != null && init_phase ){
                    //from以前のメッセージを取得(中身はatに過去時刻を指定したときのsegmentと同じモノ)
                    // await pull_messages(entry.previous.uri);
                    console.log( "previous" );
                }else if( entry.segment != null ){//最初のentry.segmentはfrom <= at < untilの区間を持っている
                    console.log( "segment" );
                    init_phase = false;
                    //10秒先読みする(ライブ時は取得可能になったタイミング(現ndgr実装だと5秒前)に配信されるので10秒先読みリクエストにはならない)
                    // await sleep_until(entry.segment.from, 10_000);
                    //segmentのpull_messagesをawaitすることは実運用上できないでしょう
                    //ここでawaitしてしまうと次のsegmentを先読みができないためです
                    //また先読みしなかったとしてもsegmentのレスポンスが終わるのまでにuntilを必ず超えるため、次にsegment取得まで隙間が空きます
                    //そのためここでawaitするとライブ時に詰まりなく受信することは不可能となっています
                    this.pull_messages( entry.segment.uri );
                }else if( entry.next != null ){
                    //このメッセージが配送されたら次のplaylistが取得可能になっています
                    next = entry.next.at;
                }
            }
        }
    },

    messageRetriever: async function* ( uri, decoder ){
        // console.log( `message server uri: ${room.viewUri}` );
        const res = await fetch( uri );
        if( res.ok ){
            const tmp = res.body.getReader();
            //productionではstreamが通信障害等で切れたときの対応も考える必要があります。その時はtmp.read()がエラーを出すはず
            const stream = {
                [Symbol.asyncIterator](){
                    return {next: () => tmp.read()}
                }
            }
            let unread = [];
            for await( const chunk of stream ){
                const buffer = new protobuf.Reader( [...unread, ...chunk] );
                unread = [];
                while( buffer.pos < buffer.len ){
                    const current_pos = buffer.pos;
                    try{
                        yield decoder.decodeDelimited( buffer )
                    }catch( e ){
                        if( e instanceof RangeError ){
                            console.log( e );
                            //protobufが途中でちぎれていた場合RangeErrorになるので未読分をunreadにつめる
                            const uri = room.viewUri;
                            console.log( {err: "Range", current_pos, unread: (buffer.len - current_pos), uri} )
                            unread = buffer.buf.slice( current_pos, buffer.len );
                            break
                        }else{
                            console.log( {"decode error": room.viewUri, "reason": e} );
                            throw e;
                        }
                    }
                }
            }
            // show({"fetch completed": uri});
        }else{
            console.log( {"status": res.status, "fetch error": room.viewUri} );
            throw new Error( "fetch error", room.viewUri );
        }
    },

    /**
     * WebSocketでコメントサーバーに接続する.
     * @param room
     */
    connectCommentServer_: function( room ){
        console.log( 'connect comment server(websocket)...' );
        console.log( `websocket uri: ${room.viewUri}` );
        console.log( `thread id: ${room.threadId}` );
        console.log( `room name: ${room.name}` );
        // console.log( `server type: ${room.messageServer.type}` );

        this.threadId = room.threadId;
        this.yourPostKey = room.yourPostKey;

        // sub-protocol "msg.nicovideo.jp#json"
        this._comment_svr = new Comm( room.viewUri, "msg.nicovideo.jp#json" );
        this._comment_svr.connect();
        this._comment_svr.onConnect( ( ev ) => {
            console.log( 'comment server connected.' );
            this.connecttime = GetCurrentTime();

            // 過去ログ取得行数指定
            let lines = Config['comment-backlog-num'] * -1;
            // let lines = -50;
            let str = {
                "thread": {
                    "thread": "" + room.threadId,
                    "version": "20061206",
                    "user_id": this.nico_user_id,
                    "res_from": lines,
                    "with_global": 1,
                    "scores": 1,
                    "nicoru": 0,
                    "threadKey": room.yourPostKey
                }
            };
            this._comment_svr.send( JSON.stringify( str ) );
            // TODO サーバーに接続した時の処理をここに書く
            this.showAlert( `コメントサーバーに接続しました` );

            // 再生履歴に番組名と開始時刻を記録
            let hist;
            hist = `${this.liveProp.program.nicoliveProgramId} ${this.liveProp.program.title} (${GetDateString( this.liveProp.program.beginTime * 1000, true )}-)\n`;
            NicoLiveHistory.addHistoryText( hist );

            (async () => {
                await this.initProgressBar();
                if( !this.currentVideo && !this._startup_comment_sent ){
                    this.sendStartupComment();
                }
            })();

            setInterval( () => {
                // 1分間隔で空データ送ってるのでkeepalive用っぽい
                this._comment_svr.send( '' );
            }, 60 * 1000 );
        } );
        this._comment_svr.onReceive( ( ev ) => {
            let data = JSON.parse( ev.data );
            this.onCommentReceived( data );
        } );
        this._comment_svr.onError( ( ev ) => {
            console.log( ev );
            let str = `コメントサーバーとの接続でエラーが発生しました`;
            this.showAlert( str, true );
            alert( str );
        } );
    },

    onWatchCommandReceived: function( data ){
        console.log( '[WatchWS] Received command:', data.type, data );
        let body = data.data;
        switch( data.type ){
        case 'messageServer':
            this.connecttime = GetCurrentTime();
            if( body && body.viewUri ){
                if( this._active_comment_view_uri !== body.viewUri ){
                    this._active_comment_view_uri = body.viewUri;
                    this.connectCommentServer( body );
                }else{
                    console.log( '[WatchWS] Already connected to comment server URI:', body.viewUri );
                }
            }
            (async () => {
                await this.initProgressBar();
                if( !this.currentVideo && !this._startup_comment_sent ){
                    this._startup_comment_sent = true;
                    this.sendStartupComment();
                }
            })();
            break;

        case 'statistics':
            if( body && typeof body.viewers !== 'undefined' ){
                $( '#number-of-listeners' ).text( FormatCommas( body.viewers ) );
                console.log( `Now ${body.viewers} listener(s).` );
            }
            break;

        case 'schedule':
            if( body && body.begin && body.end ){
                console.log( body.begin );
                this.live_begintime = parseInt( (new Date( body.begin )).getTime() / 1000 );
                this.live_endtime = parseInt( (new Date( body.end )).getTime() / 1000 );
                $( '#live-progress' ).attr( 'title', `終了日時: ${GetDateTimeString( this.live_endtime * 1000, 1 )}` );
            }
            break;

        case 'ping':
            if( this._comm && this._comm.isOpen() ){
                this._comm.send( '{"type":"pong"}' );
            }
            break;

        case 'seat':
            if( this._seat_interval ){
                clearInterval( this._seat_interval );
                this._seat_interval = null;
            }
            let keepInterval = ( body && body.keepIntervalSec ? body.keepIntervalSec : 30 ) * 1000;
            this._seat_interval = setInterval( () => {
                if( this._comm && this._comm.isOpen() ){
                    this._comm.send( '{"type":"keepSeat"}' );
                }
            }, keepInterval );
            break;

        case 'reconnect':
            console.log( '[WatchWS] Received reconnect command from server:', body );
            if( body && body.audienceToken ){
                this._ws_audience_token = body.audienceToken;
                console.log( '[WatchWS] Updated audienceToken for reconnect.' );
            }
            let waitTimeSec = ( body && typeof body.waitTimeSec === 'number' ) ? body.waitTimeSec : 0;
            if( this._comm ){
                this._comm.close( 1000, 'Server requested reconnect' );
            }
            this.scheduleReconnect( waitTimeSec, true );
            break;

        case 'disconnect':
            let reason = ( body && body.reason ) || 'UNKNOWN';
            console.warn( `[WatchWS] Received disconnect command: ${reason}` );
            switch( reason ){
            case 'END_PROGRAM':
                this._ws_is_intentional_close = true;
                this.showAlert( '番組が終了しました' );
                break;
            case 'TAKEOVER':
                this._ws_is_intentional_close = true;
                this.showAlert( '他の端末またはブラウザから視聴されたため切断されました（追い出し）', true );
                break;
            case 'NO_PERMISSION':
                this._ws_is_intentional_close = true;
                this.showAlert( '座席を取得できませんでした', true );
                break;
            case 'TOO_MANY_CONNECTIONS':
            case 'TOO_MANY_WATCHINGS':
                this._ws_is_intentional_close = true;
                this.showAlert( `接続制限に達したため切断されました (${reason})`, true );
                break;
            case 'SERVICE_TEMPORARILY_UNAVAILABLE':
            case 'PING_TIMEOUT':
            case 'CROWDED':
            default:
                this.showAlert( `サーバーから一時切断されました (${reason})。再接続を試みます...` );
                break;
            }
            break;

        case 'postCommentResult':
            break;
        }
    },

    /**
     * WebSocket URL を生成（audience_token が更新されている場合は適用）.
     * @returns {string|null}
     */
    getWatchWebSocketUrl: function(){
        if( !this.liveProp || !this.liveProp.site || !this.liveProp.site.relive ){
            return null;
        }
        let urlStr = this.liveProp.site.relive.webSocketUrl;
        if( !urlStr ) return null;

        try {
            let url = new URL( urlStr );
            if( this.liveProp.site.frontendId && !url.searchParams.has( 'frontend_id' ) ){
                url.searchParams.set( 'frontend_id', this.liveProp.site.frontendId );
            }
            if( this._ws_audience_token ){
                url.searchParams.set( 'audience_token', this._ws_audience_token );
            }
            return url.toString();
        } catch( e ) {
            let ws = urlStr;
            if( this.liveProp.site.frontendId && !ws.includes( 'frontend_id=' ) ){
                ws += ( ws.includes( '?' ) ? '&' : '?' ) + `frontend_id=${this.liveProp.site.frontendId}`;
            }
            if( this._ws_audience_token ){
                if( ws.includes( 'audience_token=' ) ){
                    ws = ws.replace( /([?&]audience_token=)[^&]*/, `$1${encodeURIComponent( this._ws_audience_token )}` );
                } else {
                    ws += ( ws.includes( '?' ) ? '&' : '?' ) + `audience_token=${encodeURIComponent( this._ws_audience_token )}`;
                }
            }
            return ws;
        }
    },

    /**
     * WebSocket切断時の再接続をスケジュールする.
     * @param {number} [waitTimeSec] サーバーから指定された待機秒数
     * @param {boolean} [isServerInitiated] サーバーからのreconnect指示によるものか
     */
    scheduleReconnect: function( waitTimeSec, isServerInitiated ){
        if( this._ws_is_intentional_close ){
            console.log( '[WatchWS] Will not reconnect because close was intentional.' );
            return;
        }

        const MAX_ATTEMPTS = 10;
        if( this._ws_reconnect_attempts >= MAX_ATTEMPTS ){
            console.error( `[WatchWS] Reconnect failed: exceeded max attempts (${MAX_ATTEMPTS}).` );
            this.showAlert( 'WebSocketへの再接続上限回数を超えたため再接続を中止しました。', true );
            this._ws_is_reconnecting = false;
            return;
        }

        if( this._ws_reconnect_timer ){
            clearTimeout( this._ws_reconnect_timer );
            this._ws_reconnect_timer = null;
        }

        let delayMs;
        if( isServerInitiated && typeof waitTimeSec === 'number' && waitTimeSec >= 0 ){
            delayMs = ( waitTimeSec * 1000 ) + Math.floor( Math.random() * 500 );
        }else{
            let baseDelay = Math.min( 1500 * Math.pow( 1.5, this._ws_reconnect_attempts ), 30000 );
            delayMs = Math.round( baseDelay + Math.floor( Math.random() * 1000 ) );
        }

        this._ws_reconnect_attempts++;
        this._ws_is_reconnecting = true;
        console.log( `[WatchWS] Scheduling reconnect attempt #${this._ws_reconnect_attempts} in ${delayMs}ms...` );
        this.showAlert( `WebSocket切断を検知しました。${Math.ceil( delayMs / 1000 )}秒後に再接続します...` );

        this._ws_reconnect_timer = setTimeout( () => {
            this._ws_reconnect_timer = null;
            this.connectServer( true );
        }, delayMs );
    },

    /**
     * WebSocketを切断し、タイマーを停止する.
     */
    disconnectServer: function(){
        this._ws_is_intentional_close = true;
        if( this._ws_reconnect_timer ){
            clearTimeout( this._ws_reconnect_timer );
            this._ws_reconnect_timer = null;
        }
        this._ws_is_reconnecting = false;
        this._ws_reconnect_attempts = 0;
        this._ws_audience_token = null;
        if( this._seat_interval ){
            clearInterval( this._seat_interval );
            this._seat_interval = null;
        }
        if( this._comm ){
            this._comm.close( 1000, 'Client disconnected' );
            this._comm = null;
        }
    },

    /**
     * ニコ生に接続開始する.
     * @param {boolean} [isReconnect=false] 再接続かどうか
     */
    connectServer: function( isReconnect ){
        isReconnect = !!isReconnect;
        console.log( `[WatchWS] connect websocket... (isReconnect: ${isReconnect})` );

        this._ws_is_intentional_close = false;

        if( this._seat_interval ){
            clearInterval( this._seat_interval );
            this._seat_interval = null;
        }
        if( this._comm ){
            try {
                this._comm.close( 1000, 'Reconnecting' );
            } catch( e ) {
                console.warn( '[WatchWS] Error closing old comm socket:', e );
            }
            this._comm = null;
        }

        let ws = this.getWatchWebSocketUrl();
        if( !ws ){
            console.error( '[WatchWS] WebSocket URL is not available in liveProp.' );
            this.showAlert( 'WebSocket接続先URLが取得できませんでした', true );
            return;
        }

        this._comm = new Comm( ws );
        let socket = this._comm.connect();
        if( !socket ){
            console.error( '[WatchWS] Failed to instantiate WebSocket.' );
            this.scheduleReconnect( 0, false );
            return;
        }

        this._comm.onConnect( ( ev ) => {
            console.log( `[WatchWS] Connected. ${this.liveProp.program.nicoliveProgramId}` + ( isReconnect ? ' (reconnected)' : '' ) );
            this._ws_reconnect_attempts = 0;
            this._ws_is_reconnecting = false;
            if( isReconnect ){
                this.showAlert( 'WebSocketに再接続しました' );
            }

            setTimeout( () => {
                let initmsg;
                if( isReconnect ){
                    initmsg = { "type": "startWatching", "data": { "reconnect": true } };
                }else{
                    initmsg = { "type": "startWatching", "data": {} };
                }
                if( this._comm && this._comm.isOpen() ){
                    this._comm.send( JSON.stringify( initmsg ) );
                }
            }, 100 );
        } );

        this._comm.onReceive( ( ev ) => {
            try {
                let data = JSON.parse( ev.data );
                this.onWatchCommandReceived( data );
            } catch( err ) {
                console.error( '[WatchWS] JSON parse error in onReceive:', err, ev.data );
            }
        } );

        this._comm.onError( ( ev ) => {
            console.error( '[WatchWS] Socket error encountered:', ev );
        } );

        this._comm.onClose( ( ev ) => {
            console.warn( `[WatchWS] Socket closed (code: ${ev.code}, reason: ${ev.reason || 'none'}, wasClean: ${ev.wasClean})` );
            if( this._seat_interval ){
                clearInterval( this._seat_interval );
                this._seat_interval = null;
            }

            if( !this._ws_is_intentional_close ){
                this.scheduleReconnect( 0, false );
            }
        } );
    },

    startLive: function(){
        let uri = `https://live2.nicovideo.jp/unama/api/v3/programs/${this.getLiveId()}/segment?state=on_air`;
        let xhr = CreateXHR( 'PUT', uri );
        xhr.onreadystatechange = async () => {
            if( xhr.readyState != 4 ) return;
            let error = JSON.parse( xhr.responseText );
            if( xhr.status != 200 ){
                console.log( `${xhr.status} ${xhr.responseText}` );
                this.showAlert( `放送開始エラー: ${error.meta.errorCode}` );
            }else{
                if( error.meta.status == 200 ){
                    this.showAlert( '放送を開始しました' );
                    await this.autoStartQuote();
                }else{
                    this.showAlert( `放送開始エラー: ${error.meta.errorCode}` );
                }
            }
        };

        xhr.setRequestHeader( 'X-Public-Api-Token', this.liveProp.site.relive.csrfToken );
        xhr.send();
    },


    /**
     * 動画情報のXMLをJavascriptオブジェクトにする.
     *
     * @param xml
     * @returns {Object}
     * @throw String エラーコードを例外として投げる
     */
    extractVideoInfo: function( xml ){
        // ニコニコ動画のgetthumbinfoのXMLから情報抽出.
        let info = new VideoInformation();

        let error = GetXmlText( xml, "/nicovideo_thumb_response/error/code" );
        if( error ){
            // COMMUNITY or NOT_FOUND or DELETED
            throw error;
        }

        let root;
        root = xml.getElementsByTagName( 'thumb' )[0];
        if( !root ) throw "no thumb tag";

        let tags = ["jp", "tw", "us"];
        let tagscnt = 0;
        for( let i = 0, elem; elem = root.childNodes[i]; i++ ){
            switch( elem.tagName ){
            case "user_id":
                info.user_id = elem.textContent;
                break;
            case "user_nickname":
                // 投稿者名
                info.user_nickname = elem.textContent;
                break;
            case "video_id":
                info.video_id = elem.textContent;
                break;
            case "title":
                info.title = restorehtmlspecialchars( elem.textContent );
                break;
            case "description":
                info.description = restorehtmlspecialchars( elem.textContent ).replace( /　/g, ' ' );
                info.description = info.description.replace( /<.*?>/g, "" );
                break;
            case "thumbnail_url":
                info.thumbnail_url = elem.textContent;
                break;
            case "first_retrieve":
                // Firefox 4からISO 8601フォーマットを読めるのでそのまま利用
                let d = new Date( elem.textContent );
                info.first_retrieve = d.getTime() / 1000; // seconds from epoc.
                break;
            case "length":
                // TODO getthumbinfoの情報と実際の再生時間が違う動画がある
                if( 0 && this._videolength["_" + info.video_id] ){
                    // getthumbinfo のデータと実際が合わない動画があるので調整データベースから
                    info.length = this._videolength["_" + info.video_id];
                }else{
                    info.length = elem.textContent;
                }
                let len = info.length.match( /\d+/g );
                info.length_ms = (parseInt( len[0], 10 ) * 60 + parseInt( len[1], 10 )) * 1000;
                break;
            case "view_counter":
                info.view_counter = parseInt( elem.textContent );
                break;
            case "comment_num":
                info.comment_num = parseInt( elem.textContent );
                break;
            case "mylist_counter":
                info.mylist_counter = parseInt( elem.textContent );
                break;
            case "tags":
                // attribute domain=jp のチェックが必要.
                // また、半角に正規化.
                let domain = elem.getAttribute( 'domain' ) || 'jp';
                let tag = elem.getElementsByTagName( 'tag' );
                if( !info.tags ){
                    info.tags = {};
                    info.tags_locked = {};
                }
                if( !info.tags[domain] ){
                    info.tags[domain] = [];
                    info.tags_locked[domain] = [];
                }else{
                    domain = 'tag' + tagscnt;
                    info.tags[domain] = [];
                    info.tags_locked[domain] = [];
                }
                if( !info.tags_array ) info.tags_array = [];
                for( let i = 0, item; item = tag[i]; i++ ){
                    let tag = restorehtmlspecialchars( ZenToHan( item.textContent ) );
                    info.tags[domain].push( tag );
                    info.tags_array.push( tag );

                    let tmp = item.getAttribute( 'lock' );
                    info.tags_locked[domain].push( !!tmp );
                }
                tagscnt++;
                break;
            case "size_high":
                info.filesize = parseInt( elem.textContent );
                info.highbitrate = elem.textContent;
                info.highbitrate = (info.highbitrate * 8 / (info.length_ms / 1000) / 1000).toFixed( 2 ); // kbps "string"
                break;
            case "size_low":
                info.lowbitrate = elem.textContent;
                info.lowbitrate = (info.lowbitrate * 8 / (info.length_ms / 1000) / 1000).toFixed( 2 ); // kbps "string"
                break;
            case "movie_type":
                info.movie_type = elem.textContent;
                break;
            case "no_live_play":
                info.no_live_play = parseInt( elem.textContent );
                break;
            default:
                break;
            }
        }
        // video_id がないときはエラーとしておこう、念のため.
        if( !info.video_id ){
            throw "no video id.";
        }

        // TODO P名取得
        // try{
        //     info.pname = this.getPName( info );
        // }catch( x ){
        //     info.pname = "";
        // }

        try{
            info.mylistcomment = NicoLiveMylist.mylist_itemdata["_" + info.video_id].description;
        }catch( x ){
            info.mylistcomment = "";
        }

        // TODO 機械学習による分類機能
        // if( Config.do_classify  ){
        //     let str = new Array();
        //     // 半角小文字で正規化してトレーニングをしているので、分類するときもそのように.
        //     for( k in info.tags ){
        //         for( let i = 0, tag; tag = info.tags[k][i]; i++ ){
        //             str.push( ZenToHan( tag.toLowerCase() ) );
        //         }
        //     }
        //     info.classify = NicoLiveClassifier.classify( str );
        // }

        return info;
    },

    /**
     * 動画情報を取得する.
     * @param video_id
     * @returns {Promise}
     */
    getVideoInfo: function( video_id ){
        let p1 = new Promise( ( resolve, reject ) => {
            NicoApi.getthumbinfo( video_id, ( xml, req ) => {
                try{
                    let vinfo = NicoLiveHelper.extractVideoInfo( xml );
                    vinfo.video_id = video_id;
                    resolve( vinfo );
                }catch( e ){
                    if( e === 'DELETED' ){
                    }
                    console.log( 'extract failed:' + e + ' ' + video_id );
                    reject( e );
                }
            } );
        } );
        return p1;
    },

    /**
     * 新配信で再生できる動画かどうかを返す. 現在使用不可。
     * 再生できなければ false, 再生できるなら動画IDとタイトルのオブジェクトを返す.
     * @param video_id
     * @returns {Promise<any>}
     */
    isAvailableInNewLive: function( video_id ){
        let url = `${this.endpointUrl}/v1/tools/live/quote/services/video/contents/${video_id}`;
        let p = new Promise( ( resolve, reject ) => {
            let xhr = CreateXHR( 'GET', url );
            xhr.onreadystatechange = () => {
                if( xhr.readyState != 4 ) return;
                if( xhr.status != 200 ){
                    //let err = JSON.parse( xhr.responseText );
                    resolve( false );
                    return;
                }
                let res = JSON.parse( xhr.responseText );
                if( res.meta.status == 200 ){
                    resolve( res.data.quotable );
                }else{
                    resolve( false );
                }
            };
            xhr.send();
        } );
        return p;
    },

    /**
     * 配列をソートする.
     * @param queue ソートする配列
     * @param type ソート方法
     * @param order 昇順(1) or 降順(-1)
     */
    sortVideoList: function( queue, type, order ){
        // order:1だと昇順、order:-1だと降順.
        queue.sort( function( a, b ){
            let tmpa, tmpb;
            switch( type ){
            case 0:// 再生数.
                tmpa = a.view_counter;
                tmpb = b.view_counter;
                break;
            case 1:// コメ.
                tmpa = a.comment_num;
                tmpb = b.comment_num;
                break;
            case 2:// マイリス.
                tmpa = a.mylist_counter;
                tmpb = b.mylist_counter;
                break;
            case 3:// 時間.
                tmpa = a.length_ms;
                tmpb = b.length_ms;
                break;
            case 4:// 投稿日.
            default:
                tmpa = a.first_retrieve;
                tmpb = b.first_retrieve;
                break;
            case 5:// マイリス率.
                tmpa = a.mylist_counter / a.view_counter;
                tmpb = b.mylist_counter / b.view_counter;
                break;
            case 6:// タイトル.
                if( a.title < b.title ){
                    return -order;
                }else{
                    return order;
                }
                break;
            case 7:// マイリス登録日.
                tmpa = a.registerDate;
                tmpb = b.registerDate;
                break;
            case 8:// 宣伝ポイント.
                tmpa = a.uadp;
                tmpb = b.uadp;
                break;
            case 9:// ビットレート
                tmpa = a.highbitrate;
                tmpb = b.highbitrate;
                break;
            }
            return (tmpa - tmpb) * order;
        } );
    },

    /**
     * 動画情報の表示用のエレメントを作成して返す.
     * @param vinfo{VideoInformation}
     * @returns {Node}
     */
    createVideoInfoElement: function( vinfo ){
        let t = document.querySelector( '#template-video-info' );
        let clone2 = document.importNode( t.content, true );
        let elem = clone2.firstElementChild;
        elem.setAttribute( 'nico_video_id', vinfo.video_id );
        if( vinfo.is_played ){
            $( elem ).addClass( 'video_played' );
        }

        let thumbnail_image = elem.querySelector( '.nico-thumbnail' );
        let bitrate = elem.querySelector( '.nico-bitrate' );
        let title = elem.querySelector( '.nico-title' );
        let video_prop = elem.querySelector( '.nico-video-prop' );
        let description = elem.querySelector( '.nico-description' );
        let tags = elem.querySelector( '.nico-tags' );
        let link = elem.querySelector( '.nico-link' );
        let rights_code = elem.querySelector( '.rights-code' );

        $( rights_code ).text( vinfo.rights_code );

        if( vinfo.no_live_play ){
            $( title ).addClass( 'no_live_play' );
        }
        if( vinfo.is_self_request ){
            $( elem ).addClass( 'self_request' );
            $( title ).addClass( 'self_request' );
        }

        link.setAttribute( "href", "https://www.nicovideo.jp/watch/" + vinfo.video_id );

        thumbnail_image.src = vinfo.thumbnail_url;
        thumbnail_image.addEventListener( 'mouseover', ( ev ) => {
            NicoLiveHelper.showThumbnail( ev, vinfo.video_id );
        } );
        thumbnail_image.addEventListener( 'mouseout', ( ev ) => {
            NicoLiveHelper.hideThumbnail();
        } );

        bitrate.textContent = vinfo.highbitrate.substring( 0, vinfo.highbitrate.length - 3 ) + 'k/' + vinfo.movie_type;
        title.textContent = vinfo.video_id + ' ' + vinfo.title;
        let tmp = GetDateString( vinfo.first_retrieve * 1000, true );
        video_prop.textContent = '投:' + tmp + ' 再:' + FormatCommas( vinfo.view_counter )
            + ' コ:' + FormatCommas( vinfo.comment_num ) + ' マ:' + FormatCommas( vinfo.mylist_counter ) + ' 時間:' + vinfo.length;

        //--- description
        // description.textContent = vinfo.description;
        {
            let div2 = document.createElement( 'div' );
            let str;
            str = vinfo.description.split( /(mylist\/\d+|sm\d+|nm\d+)/ );
            for( let i = 0; i < str.length; i++ ){
                let s = str[i];
                if( s.match( /mylist\/\d+/ ) ){
                    let a = document.createElement( 'a' );
                    let mylist = s;
                    a.setAttribute( "href", "https://www.nicovideo.jp/" + mylist );
                    a.setAttribute( "target", "_blank" );
                    a.setAttribute( "style", "text-decoration: underline;" );
                    a.appendChild( document.createTextNode( s ) );
                    div2.appendChild( a );
                }else if( s.match( /(sm|nm)\d+/ ) ){
                    let a = document.createElement( 'a' );
                    let vid = s;
                    a.setAttribute( "href", "https://www.nicovideo.jp/watch/" + vid );
                    a.setAttribute( "target", "_blank" );
                    a.setAttribute( "style", "text-decoration: underline;" );

                    a.addEventListener( 'mouseover', ( ev ) => {
                        NicoLiveHelper.showThumbnail( ev, vid );
                    } );
                    a.addEventListener( 'mouseout', ( ev ) => {
                        NicoLiveHelper.hideThumbnail();
                    } );
                    a.appendChild( document.createTextNode( s ) );
                    div2.appendChild( a );
                }else{
                    div2.appendChild( document.createTextNode( s ) );
                }
            }
            description.appendChild( div2 );
        }

        vinfo.tags['jp'].forEach( ( elem, idx, arr ) => {
            let tag = document.createElement( 'span' );
            tag.setAttribute( 'class', 'badge badge-secondary' );
            tag.textContent = elem + ' ';

            if( vinfo.tags_locked['jp'][idx] ){
                let lockicon = document.createElement( 'span' );
                lockicon.setAttribute( 'class', 'glyphicon glyphicon-lock' );
                lockicon.setAttribute( 'aria-hidden', 'true' );
                tag.append( lockicon );
            }

            tags.appendChild( tag );
            tags.appendChild( document.createTextNode( ' ' ) );
        } );
        return elem;
    },

    /**
     * リストに含まれている動画の合計時間を返す.
     * @param list
     * @returns {{min: (Number|*), sec: (number|*)}}
     */
    calcTotalVideoTime: function( list ){
        let t = 0;
        let s;

        for( let i = 0, item; item = list[i]; i++ ){
            s = item.length_ms;
            t += s;
        }
        t /= 1000;
        let min, sec;
        min = parseInt( t / 60 );
        sec = t % 60;
        if( sec < 10 ){
            sec = '0' + sec;
        }
        return {"min": min, "sec": sec};
    },

    /**
     * 動画サムネイルを表示する.
     * @param event DOMイベント
     * @param video_id 動画ID
     */
    showThumbnail: function( event, video_id ){
        document.querySelector( '#iframe-thumbnail' ).src = "http://ext.nicovideo.jp/thumb/" + video_id;
        let x, y;
        // 312x176
        x = event.clientX;
        y = event.clientY;
        if( y + 176 > window.innerHeight ){
            y = y - 176 - 10;
        }
        if( x + 312 > window.innerWidth ){
            x = x - 312 - 10;
        }
        document.querySelector( '#iframe-thumbnail' ).style.left = x + 5 + "px";
        document.querySelector( '#iframe-thumbnail' ).style.top = y + 5 + "px";
        document.querySelector( '#iframe-thumbnail' ).style.display = 'block';
        document.querySelector( '#iframe-thumbnail' ).width = 312;
        document.querySelector( '#iframe-thumbnail' ).height = 176;
        document.querySelector( '#iframe-thumbnail' ).style.opacity = 1;
    },

    /**
     * 動画サムネイルを非表示にする.
     */
    hideThumbnail: function(){
        document.querySelector( '#iframe-thumbnail' ).width = 312;
        document.querySelector( '#iframe-thumbnail' ).height = 0;
        document.querySelector( '#iframe-thumbnail' ).style.opacity = 0;
    },

    /**
     * ウィンドウ下部にアラートメッセージを表示する.
     * @param text
     */
    showAlert: function( text, nohide ){
        $( '#my-alert-message' ).text( text );
        $( '#my-alert' ).show( 100 );

        clearTimeout( this._alert_timer );
        if( !nohide ){
            this._alert_timer = setTimeout( function(){
                $( '#my-alert' ).hide( 100 );
            }, 4000 );
        }
    },


    updateVideoProgress: function( now ){
        // 動画の経過時間
        try{
            let current = this.currentVideo;
            let remain = current.play_end - now;
            if( remain < 0 ) remain = 0;

            let text = `${current.title}(-${GetTimeString( remain )})`;
            switch( this._remain_timer_format_type ){
            case 0:
            default:
                break;
            case 1:
                text = `${current.title}(${GetTimeString( now - current.play_begin )})`;
                break;
            case 2:
                text = `${current.title}(枠残り${GetTimeString( this.live_endtime - current.play_end )})`;
                break;
            }
            $( '#remaining-time-main' ).text( text );

            let len = parseInt( current.length_ms / 1000 );
            let t = now - current.play_begin;

            let percent = parseInt( (t / len) * 100 );
            if( percent > 100 ) percent = 100;
            this.setProgressMain( percent );
        }catch( e ){
            $( '#remaining-time-main' ).text( `---(-0:00)` );
        }
    },

    /**
     * 毎秒更新処理.
     */
    update: function(){
        let now = GetCurrentTime();

        this.updateVideoProgress( now );

        // 生放送の経過時間
        if( this.live_begintime ){
            let liveprogress = now - this.live_begintime;
            $( '#live-progress' ).text( liveprogress < 0 ? `-${GetTimeString( -liveprogress )}` : GetTimeString( liveprogress ) );
        }
    },


        /**
     * STSen アカウント管理 & 手動枠接続 UI の初期化
     */
    initSTSenAccountUI: function(){
        console.log('[STSen] Initializing Account & Manual Connect UI...');

        const updateAccountUI = async () => {
            if (typeof window.stsen !== 'undefined' && window.stsen.getAccountStatus) {
                try {
                    const status = await window.stsen.getAccountStatus();
                    console.log('[STSen] Account status received:', status);
                    if (status && status.loggedIn) {
                        const name = (status.user && status.user.nickname) || 'ログイン中';
                        const id = (status.user && status.user.id) ? 'ID: ' + status.user.id : '';
                        $('#btn-account-login').hide();
                        $('#account-badge').show();
                        $('#account-nickname').text(name);
                        if (id) {
                            $('#account-user-id').text(id).show();
                        } else {
                            $('#account-user-id').hide();
                        }
                    } else {
                        $('#account-badge').hide();
                        $('#btn-account-login').show();
                    }
                } catch (e) {
                    console.error('[STSen] Failed to update account UI:', e);
                }
            } else {
                console.warn('[STSen] window.stsen is not available');
            }
        };

        $(document).on('click', '#btn-account-login', async function(e){
            e.preventDefault();
            console.log('[STSen] Login button clicked. window.stsen:', typeof window.stsen);
            if (window.stsen && window.stsen.openLoginWindow) {
                try {
                    await window.stsen.openLoginWindow();
                } catch (err) {
                    console.error('[STSen] openLoginWindow error:', err);
                }
            } else {
                console.warn('[STSen] window.stsen.openLoginWindow is unavailable!');
            }
        });

        
        $(document).on('click', '#menu-input-session', async function(e){
            e.preventDefault();
            const promptMsg = '普段お使いのブラウザ（Chrome/Edge等）でニコニコにログイン後、Cookieの「user_session」の値を入力してください：\n（例: user_session_12345678_...）';
            const res = await ShowPromptDialog(promptMsg, '');
            if (res && res.trim()) {
                if (window.stsen && window.stsen.setUserSession) {
                    const result = await window.stsen.setUserSession(res.trim());
                    if (result.success) {
                        alert('ログインに成功しました！（' + ((result.user && result.user.nickname) || '認証完了') + '）');
                        location.reload();
                    } else {
                        alert('セッションの認証に失敗しました。値をご確認ください。');
                    }
                }
            }
        });

        $(document).on('click', '#menu-login', function(e){
            e.preventDefault();
            console.log('[STSen] Menu login clicked');
            if (window.stsen && window.stsen.openLoginWindow) {
                window.stsen.openLoginWindow();
            }
        });

        $(document).on('click', '#btn-account-relogin', function(e){
            e.preventDefault();
            console.log('[STSen] Re-login clicked');
            if (window.stsen && window.stsen.openLoginWindow) {
                window.stsen.openLoginWindow();
            }
        });

        $(document).on('click', '#btn-account-logout', async function(e){
            e.preventDefault();
            if (confirm('ニコニコからログアウトしますか？')) {
                if (window.stsen && window.stsen.logout) {
                    await window.stsen.logout();
                }
                location.reload();
            }
        });

        $(document).on('click', '#open-config-folder', function(e){
            e.preventDefault();
            if (window.stsen && window.stsen.openConfigFolder) {
                window.stsen.openConfigFolder();
            }
        });

        $(document).on('click', '#menu-reset-all-data', function(e){
            e.preventDefault();
            if (window.stsen && window.stsen.resetAllData) {
                window.stsen.resetAllData();
            }
        });

        const showAbout = function(e) {
            if (e) e.preventDefault();
            if (window.stsen && window.stsen.showAboutDialog) {
                window.stsen.showAboutDialog();
            } else if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getManifest) {
                const manifest = browser.runtime.getManifest();
                alert(`${manifest.name || 'New NicoLive Helper'}\nバージョン: v${manifest.version}`);
            }
        };
        $(document).on('click', '#open-about', showAbout);
        $(document).on('click', '#app-version-badge', showAbout);

        if (window.stsen && window.stsen.getVersion) {
            const v = window.stsen.getVersion();
            $('.app-version-text').text(v.startsWith('v') ? v : 'v' + v);
        }

        if (typeof window.stsen !== 'undefined') {
            if (window.stsen.onAccountStatusChanged) {
                window.stsen.onAccountStatusChanged((status) => {
                    console.log('[STSen] Account status changed event:', status);
                    updateAccountUI();
                    if (status && status.loggedIn && typeof NicoLiveMylist !== 'undefined') {
                        try { NicoLiveMylist.loadMylist(); } catch (e) {}
                    }
                });
            }

            const currentLv = GetParameterByName('lv');
            if (currentLv) {
                $('#input-manual-lvid').val(currentLv);
            }
            const doConnectManual = () => {
                let val = $('#input-manual-lvid').val().trim();
                if (!val) return;
                const m = val.match(/lv\d+/) || val.match(/\d+/);
                if (m) {
                    const targetId = m[0].startsWith('lv') ? m[0] : 'lv' + m[0];
                    if (window.RemoteClient && window.RemoteClient.isConnected()) {
                        window.RemoteClient.sendAction('load-live', { lvid: targetId });
                        return;
                    }
                    window.location.href = 'main.html?lv=' + targetId;
                } else {
                    alert('有効な配信ID（例: lv12345678）を入力してください。');
                }
            };

            $(document).on('click', '#btn-manual-connect', doConnectManual);
            $(document).on('keypress', '#input-manual-lvid', function(e){
                if (e.which === 13) {
                    doConnectManual();
                }
            });

            $(document).on('click', '#btn-auto-detect-live', async function(e){
                e.preventDefault();
                if (window.RemoteClient && window.RemoteClient.isConnected()) {
                    window.RemoteClient.sendAction('detect-live');
                    return;
                }
                const $btn = $(this);
                const originalText = $btn.html();
                $btn.prop('disabled', true).html('⏳ 検出中...');

                try {
                    if (window.stsen && window.stsen.detectCurrentLive) {
                        const res = await window.stsen.detectCurrentLive();
                        if (res && res.lvid) {
                            console.log('[STSen] Detected live:', res.lvid, res.title);
                            $('#input-manual-lvid').val(res.lvid);
                            if (window.stsen.loadLive) {
                                await window.stsen.loadLive(res.lvid);
                            } else {
                                window.location.href = 'main.html?lv=' + res.lvid;
                            }
                            return;
                        } else if (res && res.message) {
                            alert(res.message);
                            return;
                        }
                    }
                    alert('現在放送中（ON AIR）または準備中の配信は見つかりませんでした。\nニコニコ生放送で番組枠を開始または作成してから再度お試しください。');
                } catch (err) {
                    console.error('[STSen] Error detecting live:', err);
                    alert('放送枠の検出に失敗しました: ' + err.message);
                } finally {
                    $btn.prop('disabled', false).html(originalText);
                }
            });

            function initRemoteClientUI() {
                const savedHost = localStorage.getItem('remote-last-host') || '';
                const savedPw = localStorage.getItem('remote-last-pw') || '';
                if (savedHost) $('#remote-host-input').val(savedHost);
                if (savedPw) $('#remote-password-input').val(savedPw);

                const openModal = (e) => {
                    if (e) e.preventDefault();
                    const isConn = window.RemoteClient && window.RemoteClient.isConnected();
                    if (isConn) {
                        $('#btn-remote-disconnect').show();
                        $('#btn-remote-connect-submit').text('再接続');
                        $('#remote-connect-status-msg').removeClass('alert-danger').addClass('alert-success').show().text(`接続中: ${window.RemoteClient.hostUrl}`);
                    } else {
                        $('#btn-remote-disconnect').hide();
                        $('#btn-remote-connect-submit').text('接続');
                        $('#remote-connect-status-msg').hide();
                    }
                    $('#modal-remote-connect').modal('show');
                };

                $(document).on('click', '#btn-remote-connect-open', openModal);
                $(document).on('click', '#menu-remote-connect', openModal);
                $(document).on('click', '#remote-connection-badge', openModal);

                $('#btn-remote-connect-submit').on('click', async () => {
                    const host = $('#remote-host-input').val().trim();
                    const pw = $('#remote-password-input').val().trim();
                    if (!host) {
                        alert('接続先ホストを入力してください');
                        return;
                    }

                    const $btn = $('#btn-remote-connect-submit');
                    $btn.prop('disabled', true).text('接続中...');
                    $('#remote-connect-status-msg').hide();

                    try {
                        localStorage.setItem('remote-last-host', host);
                        localStorage.setItem('remote-last-pw', pw);
                        await window.RemoteClient.connect(host, pw);
                        $('#modal-remote-connect').modal('hide');
                    } catch (err) {
                        $('#remote-connect-status-msg')
                            .removeClass('alert-success')
                            .addClass('alert-danger')
                            .show()
                            .text(err.message || '接続に失敗しました');
                    } finally {
                        $btn.prop('disabled', false).text('接続');
                    }
                });

                $('#btn-remote-disconnect').on('click', () => {
                    if (window.RemoteClient) {
                        window.RemoteClient.disconnect();
                    }
                    $('#modal-remote-connect').modal('hide');
                });

                // ログアウト時の確認処理
                $(document).on('click', '#btn-account-logout', (e) => {
                    if (window.RemoteClient && window.RemoteClient.isConnected()) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        $('#modal-remote-logout-confirm').modal('show');
                    }
                });

                $('#btn-logout-client-only').on('click', async () => {
                    $('#modal-remote-logout-confirm').modal('hide');
                    if (window.stsen && window.stsen.logout) {
                        await window.stsen.logout();
                        updateAccountUI();
                    }
                });

                $('#btn-logout-both').on('click', async () => {
                    $('#modal-remote-logout-confirm').modal('hide');
                    if (window.RemoteClient && window.RemoteClient.isConnected()) {
                        try {
                            window.RemoteClient.ws.send(JSON.stringify({ type: 'logout' }));
                        } catch (e) {}
                    }
                    if (window.stsen && window.stsen.logout) {
                        await window.stsen.logout();
                        updateAccountUI();
                    }
                });
            }

            updateAccountUI();
            initRemoteClientUI();
            window.__nicoliveHelperAccountUiReady = true;
        }
    },

    initUI: async function(){
        const updateLabel = document.getElementById('app-update-status');
        const renderUpdateStatus = (info) => {
            if (!updateLabel || !info) return;
            const version = info.version ? ' v' + info.version : '';
            switch (info.status) {
            case 'checking':
                updateLabel.textContent = '更新を確認しています…';
                break;
            case 'available':
                updateLabel.textContent = version + ' をダウンロードしています…';
                break;
            case 'downloading':
                updateLabel.textContent = '更新をダウンロード中 ' + (info.percent || 0) + '%';
                break;
            case 'downloaded':
                updateLabel.textContent = version + ' の更新準備が完了しました（終了時に適用）';
                break;
            case 'not-available':
                updateLabel.textContent = '最新バージョンです' + (info.version ? '（v' + info.version + '）' : '');
                break;
            case 'unsupported':
                updateLabel.textContent = info.message || 'インストーラー版で利用できます';
                break;
            case 'error':
                updateLabel.textContent = '更新確認エラー: ' + (info.message || '詳細はログを確認してください');
                break;
            default:
                updateLabel.textContent = '自動更新：起動後に確認します';
            }
        };
        if (window.stsen && typeof window.stsen.onUpdateStatus === 'function') {
            window.stsen.onUpdateStatus(renderUpdateStatus);
        }
        $( '#check-for-updates' ).on( 'click', async ( ev ) => {
            ev.preventDefault();
            if (!window.stsen || typeof window.stsen.checkForUpdates !== 'function') {
                renderUpdateStatus({ status: 'unsupported', message: '更新機能が利用できません。' });
                return;
            }
            renderUpdateStatus({ status: 'checking' });
            const result = await window.stsen.checkForUpdates();
            if (result && result.status && result.status !== 'checking') renderUpdateStatus(result);
        } );
        $( '#btn-play-next' ).on( 'click', ( ev ) => {
            if (window.RemoteClient && window.RemoteClient.isConnected()) {
                window.RemoteClient.sendAction('play-next');
                return;
            }
            // 次を再生
            this.playNext();
        } );

        $( '#btn-stop-play' ).on( 'click', ( ev ) => {
            if (window.RemoteClient && window.RemoteClient.isConnected()) {
                window.RemoteClient.sendAction('stop-play');
                return;
            }
            // 再生停止
            this.stopVideo();
        } );

        $( '#btn-resend-info' ).on( 'click', ( ev ) => {
            if (window.RemoteClient && window.RemoteClient.isConnected()) {
                window.RemoteClient.sendAction('resend-info');
                return;
            }
            // 動画情報の送信
            this.sendVideoInfo( this.currentVideo );
        } );

        /* ストックのランダム再生オプション */
        let flg = localStorage.getItem( 'stock-random' ) || false;
        flg = flg === 'true';
        document.querySelector( '#play-stock-random' ).checked = flg;

        let fstockplay = ( f ) => {
            document.querySelector( '#icon-stock-random' ).style.display = f ? 'inline' : 'none';
        };
        fstockplay( flg );
        $( '#play-stock-random' ).on( 'change', ( ev ) => {
            let flg = document.querySelector( '#play-stock-random' ).checked;
            fstockplay( flg );
            localStorage.setItem( 'stock-random', flg );
        } );

        /* プレイスタイルの変更 */
        $( '#sel-playstyle' ).on( 'change', ( ev ) => {
            if (window.RemoteClient && window.RemoteClient.isConnected()) {
                window.RemoteClient.sendAction('set-playstyle', { style: this.getPlayStyle() });
                return;
            }
            if( this.getPlayStyle() == 0 ){
                this.setAutoplayIndicator( false );
            }else{
                if( this._autoplay_timer ){
                    this.setAutoplayIndicator( true );
                }else{
                    this.setAutoplayIndicator( false );
                }
            }
            browser.storage.local.set( {'playstyle': this.getPlayStyle()} );
        } );
        let ps = 0;
        try {
            const playstyleData = await browser.storage.local.get( 'playstyle' );
            ps = playstyleData && playstyleData.playstyle || 0;
        } catch (e) {
            console.error('[Init] Failed to load playstyle; using manual mode:', e);
        }
        $( '#sel-playstyle' ).val( ps );

        // マイリストマネージャーを開く
        $( '#mylist-manager' ).on( 'click', ( ev ) => {
            window.open( 'mylistmanager/mylistmanager.html', 'nicolivehelperx_mylistmanager',
                'width=640,height=480,menubar=no,toolbar=no,location=no' );
        } );

        // 動画DBを開く
        $( '#open-video-db' ).on( 'click', ( ev ) => {
            window.open( 'db/videodb.html', 'nicolivehelperx_videodb',
                'width=640,height=480,menubar=no,toolbar=no,location=no' );
        } );

        // 次枠を作成
        $( '#create-next-live' ).on( 'click', async ( ev ) => {
            const liveId = this.getLiveId();
            if( !liveId ){
                this.showAlert( '次枠作成には現在の番組への接続が必要です' );
                return;
            }
            try {
                const result = await window.stsen.openNicoLiveCreate( liveId );
                if( !result || result.success === false ) throw new Error( result && result.error || '次枠作成ページの読み込みに失敗しました' );
            } catch( e ) {
                console.error( '[Broadcast] 次枠作成に失敗:', e );
                this.showAlert( '次枠作成ページを開けませんでした: ' + (e.message || e) );
            }
        } );

        // 放送管理画面
        $( '#broadcast-auto-create-next' ).on( 'change', async ( ev ) => {
            const enabled = !!ev.target.checked;
            Config['auto-create-next'] = enabled;
            const stored = await browser.storage.local.get( 'config' );
            const config = Object.assign( {}, stored.config || {}, { 'auto-create-next': enabled } );
            await browser.storage.local.set( { config } );
            this.showAlert( enabled
                ? '番組終了時に次枠作成ページを自動で開く設定にしました'
                : '番組終了時の次枠作成ページ自動表示をOFFにしました' );
        } );

        $( '#btn-broadcast-create-next' ).on( 'click', async () => {
            const liveId = this.getLiveId();
            if( !liveId ){
                this.showAlert( '次枠作成には現在の番組への接続が必要です' );
                return;
            }
            try {
                const result = await window.stsen.openNicoLiveCreate( liveId );
                if( !result || result.success === false ) throw new Error( result && result.error || '次枠作成ページの読み込みに失敗しました' );
            } catch( e ) {
                console.error( '[Broadcast] 次枠作成画面を開けませんでした:', e );
                this.showAlert( 'ニコ生の番組作成画面を開けませんでした' );
            }
        } );
        $( '#btn-broadcast-create-new' ).on( 'click', async () => {
            try {
                if( !window.stsen || !window.stsen.openNicoLiveCreate ) throw new Error('アプリ内番組作成機能が利用できません');
                const account = await window.stsen.getAccountStatus();
                if( !account || !account.loggedIn ){
                    this.showAlert( 'ニコニコにログインしてから新規枠を作成してください。ログイン画面を開きます。' );
                    await window.stsen.openLoginWindow();
                    return;
                }
                const result = await window.stsen.openNicoLiveCreate( '' );
                if( result && result.success === false ) throw new Error('番組作成ウィンドウを開けませんでした');
            } catch( e ) {
                console.error( '[Broadcast] 新規番組作成画面を開けませんでした:', e );
                this.showAlert( '新規枠を開けませんでした。ニコニコへのログイン状態を確認してください。' );
            }
        } );
        $( '#btn-broadcast-open-official' ).on( 'click', () => {
            const liveId = this.getLiveId();
            if( !liveId ){
                this.showAlert( '番組に接続してから公式放送画面を開いてください' );
                return;
            }
            window.open( `https://live.nicovideo.jp/watch/${liveId}`, '_blank' );
        } );



        // コメントを保存する
        $( '#save-comment' ).on( 'click', ( ev ) => {
            NicoLiveComment.saveFile();
        } );

        // 設定を開く
        $( '#open-settings' ).on( 'click', ( ev ) => {
            browser.runtime.openOptionsPage();
        } );

        // ウィンドウを閉じる
        $( '#close-window' ).on( 'click', ( ev ) => {
            window.close();
        } );


        /* リクエスト受付状態の変更 */
        let frequest = () => {
            switch( this.getRequestAllowedStatus() ){
            case 0:
                $( '#status-allow-request' ).addClass( 'allowrequest' );
                break;
            default:
                $( '#status-allow-request' ).removeClass( 'allowrequest' );
                break;
            }
        };
        $( '#sel-allow-request' ).on( 'change', ( ev ) => {
            if (window.RemoteClient && window.RemoteClient.isConnected()) {
                window.RemoteClient.sendAction('request-allow', { status: this.getRequestAllowedStatus() });
            }
            frequest();
        } );
        frequest();

        /* 音量スライダー */
        let handle = $( "#custom-handle" );
        let vol = parseInt( Config['play-default-volume'] / 10 );
        $( "#volume-slider" ).slider( {
            value: vol,
            max: 10,
            min: 0,
            create: function(){
                handle.text( $( this ).slider( "value" ) * 10 );
            },
            slide: function( event, ui ){
                handle.text( ui.value * 10 );
                NicoLiveHelper.changeVolume();
            }
        } );

        /* マイク音量スライダー */
        $( "#slider-microphone-volume" ).slider( {
            orientation: "vertical",
            range: "min",
            min: 0,
            max: 10,
            value: 0,
            slide: function( event, ui ){
                $( '#microphone-volume-setting' ).attr( 'title', `マイク音量:${ui.value}` );
                NicoLiveHelper.changeVolume();
            }
        } );

        $( '#microphone-volume-setting' ).on( 'click', ( ev ) => {
            if( $( '#slider-microphone-volume' ).is( ':visible' ) ){
                $( '#slider-microphone-volume' ).hide();
            }else{
                $( '#slider-microphone-volume' ).show();
            }
        } );

        /* とりマイ追加 */
        $( '#btn-add-toriaezu-mylist' ).on( 'click', ( ev ) => {
            let video_id = this.currentVideo.video_id;
            // coxxx lvxxx xxx から登録
            let additional_msg = `${NicoLiveHelper.getCommunityId()} ${NicoLiveHelper.getLiveId()} ${NicoLiveHelper.getLiveTitle()} から登録`;
            if( ev.metaKey || ev.ctrlKey ){
                additional_msg = window.prompt( 'マイリストコメントを入力してください', additional_msg );
                additional_msg = additional_msg || '';
            }
            NicoLiveMylist.addMylist( 'default', video_id, additional_msg );
        } );

        /**/
        $( '#progressbar' ).on( 'click', ( ev ) => {
            this._remain_timer_format_type++;
            this._remain_timer_format_type %= 3;
            this.updateVideoProgress( GetCurrentTime() );
        } );

        /* 再生中動画インジケーターのメニュー操作 */
        $.contextMenu( {
            selector: '#progressbar',
            build: ( $triggerElement, e ) => {
                let menuobj = {
                    zIndex: 10,
                    callback: ( key, options ) => {
                        if( !this.currentVideo ) return;
                        switch( key ){
                        case 'copy':
                            CopyToClipboard( this.currentVideo.video_id );
                            break;
                        case 'add_db':
                            DB.put( this.currentVideo );
                            break;
                        case 'del_db':
                            DB.delete( this.currentVideo.video_id );
                            break;
                        default:
                            let mylist_id = key.match( /^\d+_(.*)/ )[1];
                            let video_id = this.currentVideo.video_id;
                            // coxxx lvxxx xxx から登録
                            let additional_msg = `${NicoLiveHelper.getCommunityId()} ${NicoLiveHelper.getLiveId()} ${NicoLiveHelper.getLiveTitle()} から登録`;
                            if( options.metaKey || options.ctrlKey ){
                                additional_msg = window.prompt( 'マイリストコメントを入力してください', additional_msg );
                                additional_msg = additional_msg || '';
                            }
                            NicoLiveMylist.addMylist( mylist_id, video_id, additional_msg );
                            break;
                        }
                    },
                    items: {
                        "copy": {name: "動画IDをコピー"},
                        "add_mylist": {
                            name: "マイリストに追加",
                            items: {}
                        },
                        "sep1": "---------",
                        "add_db": {name: '動画DBに追加'},
                        "del_db": {name: '動画DBから削除'}
                    }
                };
                try{
                    menuobj.items.add_mylist.items['0_default'] = {name: 'あとで見る'};
                    for( let i = 0, item; item = NicoLiveMylist.mylists.mylistgroup[i]; i++ ){
                        let k = `${i + 1}_${item.id}`;
                        let v = item.name;
                        menuobj.items.add_mylist.items[k] = {name: v};
                    }
                }catch( x ){
                }
                return menuobj;
            }
        } );
        window.__nicoliveHelperMainUiReady = true;
    },

    /**
     * P名リストを更新する.
     */
    updatePNameWhitelist: function(){
        let pnames = Config['pname-whitelist'];
        pnames = pnames.split( /[\r\n]/gm );
        for( let i = 0, pname; pname = pnames[i]; i++ ){
            if( pname ){
                pname_whitelist["_" + ZenToHan( pname )] = true;
            }
        }
    },

    test: async function(){
        let obj = {
            code: '12345',
            title: 'title-name'
        };
        browser.storage.local.set( {
            'jwid': obj
        } );
    },

    /**
     * 初期化
     */
    init: async function(){
        // UIを止めないため、環境情報・設定の取得失敗は個別に吸収する。
        let extension_info = { version: (window.stsen && window.stsen.getVersion) ? window.stsen.getVersion() : '0.1.0' };
        try {
            extension_info = await browser.management.getSelf() || extension_info;
        } catch (e) {
            console.error('[Init] management.getSelf failed; using fallback version:', e);
        }
        console.log( `New NicoLive Helper ${extension_info.version}` );
        this.version = extension_info.version;
        console.log( 'initialize nicolivehelper.' );

        /* 設定のロード */
        let result = {};
        try {
            result = await browser.storage.local.get( 'config' ) || {};
        } catch (e) {
            console.error('[Init] Failed to load config; continuing with defaults:', e);
        }
        console.log( 'Config loaded:' );
        try { MergeSimpleObject( Config, result.config || {} ); }
        catch (e) { console.error('[Init] Failed to merge config; continuing with defaults:', e); }
        $( '#broadcast-auto-create-next' ).prop( 'checked', !!Config['auto-create-next'] );
        console.log( Config );
        this.updatePNameWhitelist();

        // 設定が更新されたときの再読み込み。
        // preload/Storage API が利用できなくても、ここで初期化全体を停止させない。
        if (typeof browser !== 'undefined' &&
            browser.storage &&
            browser.storage.onChanged &&
            typeof browser.storage.onChanged.addListener === 'function') {
            try {
                browser.storage.onChanged.addListener( ( changes, area ) => {
                    if( changes.config ){
                        try {
                            MergeSimpleObject( Config, changes.config.newValue || {} );
                            console.log( Config );
                            if( typeof Discord !== 'undefined' ){
                                Discord.init(); // webhook URLをConfigから読み込む
                            }
                            NicoLiveRequest.loadNGVideo();
                            this.updatePNameWhitelist();
                        } catch (e) {
                            console.error('[Storage] Failed to apply changed settings:', e);
                        }
                    }
                } );
            } catch (e) {
                console.error('[Init] Failed to register storage change listener; continuing:', e);
            }
        } else {
            console.error('[Init] browser.storage.onChanged is unavailable. UI will start in limited mode.');
        }

        // UIのイベントを先に登録する。Storage APIや放送情報取得の失敗でボタンが無反応にならないようにする。
        try {
            await this.initUI();
        } catch (e) {
            console.error('[Init] UI initialization failed; continuing with remaining modules:', e);
            showStartupDiagnostic('メイン画面の操作イベント登録に失敗しました: ' + (e && e.stack ? e.stack : String(e)));
        }
        try {
            this.initBroadcastPlayerControls();
        } catch (e) {
            console.error('[Init] Broadcast player controls failed:', e);
            showStartupDiagnostic('放送画面コントロールの初期化に失敗しました: ' + (e && e.message ? e.message : String(e)));
        }

        let lvid = GetParameterByName( 'lv' );
        console.log( 'lvid=' + lvid );
        if( lvid ){
            console.log( 'get liveinfo' );
            try {
                this.liveProp = await browser.runtime.sendMessage( {
                    cmd: 'get-liveinfo',
                    request_id: lvid
                } );
                if (this.liveProp && this.liveProp.program && this.liveProp.user) {
                    console.log( this.liveProp );
                    this.live_begintime = this.liveProp.program.beginTime;
                    this.live_endtime = this.liveProp.program.endTime;
                    this.nico_user_id = this.liveProp.user.id;
                    this.is_premium = this.liveProp.user.accountType == "premium" ? 1 : 0;
                } else {
                    console.warn('[Init] Live info was unavailable; starting offline UI.');
                    this.liveProp = null;
                }
            } catch (e) {
                console.error('[Init] Failed to load live info; starting offline UI:', e);
                this.liveProp = null;
            }
        }
        const hasLiveInfo = !!(lvid && this.liveProp && this.liveProp.program && this.liveProp.user);
        if( hasLiveInfo ) this.refreshBroadcastLivePage();
        setInterval( () => this.updateBroadcastDashboard(), 1000 );

        // 放送画面タブに既存のコメントUIを配置し、映像と左右分割で表示する。
        $( '#broadcast-live-comments-content' ).append( $( '#tab-comment-body' ) );

        // 各モジュールを独立して初期化し、一つの失敗で残りの機能を停止させない。
        const initModule = async (name, initializer) => {
            try {
                await initializer();
            } catch (e) {
                console.error(`[Init] ${name} initialization failed; continuing:`, e);
                showStartupDiagnostic(name + ' 初期化エラー: ' + (e && e.stack ? e.stack : String(e)));
            }
        };
        await initModule('Database', () => DB.initDB());
        await initModule('Talker', () => Talker.init());
        if( typeof Discord !== 'undefined' ){
            await initModule('Discord', () => Discord.init());
        }
        await initModule('Mylist', () => NicoLiveMylist.init());
        await initModule('Request', () => NicoLiveRequest.init());
        await initModule('Stock', () => NicoLiveStock.init());
        await initModule('Comment', () => NicoLiveComment.init());
        await initModule('History', () => NicoLiveHistory.init());
        await initModule('UserManage', () => UserManage.init());
        await initModule('TagSearch', () => NicoLiveTagSearch.init());
        await initModule('AccountUI', () => this.initSTSenAccountUI());

        if( hasLiveInfo ){
            // 放送IDが渡されたら放送に接続する
            this._startup_comment_sent = false;
            if( this.liveProp ){
                console.log( 'init: connecting to live' );
                this.connectServer();
                // WebSocket接続後、サーバー待機時間を設けてからautoStartQuoteを実行
                setTimeout( async () => {
                    console.log( 'init: invoking autoStartQuote with delay' );
                    await this.autoStartQuote();
                }, 2000 );
            }

            if( this.liveProp.program.providerType === 'official' ){
                $( '#live-caster' ).text( '公式' );
            }else{
                $( '#live-caster' ).text( this.liveProp.program.supplier ? this.liveProp.program.supplier.name : '---' );
            }
            $( '#live-title' ).text( this.liveProp.program.title ).attr( 'title', this.liveProp.program.title );
            // 視聴映像はログインCookieを共有するElectron webviewで表示する。
            const liveWebview = document.getElementById( 'broadcast-live-webview' );
            if( liveWebview ){
                liveWebview.src = 'https://live.nicovideo.jp/watch/' + encodeURIComponent( this.getLiveId() );
            }
            $( 'a[href="#tab-live-screen"]' ).tab( 'show' );
            // 放送管理タブへ現在の番組情報を反映
            $( '#broadcast-title' ).text( this.liveProp.program.title || '---' );
            $( '#broadcast-id' ).text( this.getLiveId() || '---' );
            $( '#broadcast-caster' ).text(
                this.liveProp.program.providerType === 'official' ? '公式' :
                ( this.liveProp.program.supplier ? this.liveProp.program.supplier.name : '---' )
            );
            $( '#broadcast-status' )
                .text( this.isCaster() ? '配信主として接続中' : '視聴中' )
                .removeClass( 'badge-secondary badge-success badge-info' )
                .addClass( this.isCaster() ? 'badge-success' : 'badge-info' );

            if( !this.isCaster() ){
                // コメント送信タイプを視聴者に設定
                $( '#type-of-comment' ).val( 1 );
            }
        }

        window.__nicoliveHelperInitCompleted = true;

        if( !this.isCaster() ){
            // 視聴者のときの再生履歴取得
            let handleMessage = async ( request, sender, sendResponse ) => {
                switch( request.cmd ){
                case 'playvideo':
                    if( request.lvid == this.getLiveId() ){
                        console.log( `Now playing sm|nm ${request.video_id}` );
                        let vinfo;
                        try{
                            vinfo = await this.getVideoInfo( `sm${request.video_id}` );
                        }catch( e ){
                            try{
                                vinfo = await this.getVideoInfo( `nm${request.video_id}` );
                            }catch( e ){
                            }
                        }
                        if( vinfo ){
                            NicoLiveHistory.addHistory( vinfo );
                            this.currentVideo = vinfo;
                            let now = GetCurrentTime();
                            this.currentVideo.play_begin = now;
                            this.currentVideo.play_end = now + parseInt( this.currentVideo.length_ms / 1000 );
                            $( '#remaining-time-main' ).text( vinfo.title );
                        }
                    }
                    break;
                default:
                    break;
                }
            }
            browser.runtime.onMessage.addListener( handleMessage );
        }

        setInterval( ( ev ) => {
            try{
                this.update();
            }catch( e ){
            }
        }, 1000 );

        // 起動時にテスト用データを書き込まない（本番UIの初期化には不要）。
    }
};


function showStartupDiagnostic(message) {
    let banner = document.getElementById('app-startup-error');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'app-startup-error';
        banner.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:999999;padding:10px 14px;background:#fff3cd;color:#664d03;border:1px solid #ffecb5;border-radius:4px;font-size:12px;white-space:pre-wrap;pointer-events:auto;';
        document.body.appendChild(banner);
    }
    banner.textContent = String(message || '初期化エラーが発生しました。');
}

window.addEventListener('error', (event) => {
    console.error('[Renderer] Uncaught error:', event.error || event.message);
    showStartupDiagnostic('画面のJavaScriptエラー: ' + (event.message || (event.error && event.error.message) || '詳細は開発ログを確認してください'));
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    console.error('[Renderer] Unhandled promise rejection:', reason);
    showStartupDiagnostic('非同期処理エラー: ' + (reason && reason.message ? reason.message : String(reason)));
});

window.addEventListener( 'load', ( ev ) => {
    if (typeof browser === 'undefined' || typeof window.stsen === 'undefined') {
        console.error('[Init] Electron preload bridge is unavailable.', {
            browserAvailable: typeof browser !== 'undefined',
            stsenAvailable: typeof window.stsen !== 'undefined'
        });
        showStartupDiagnostic('アプリ連携機能（preload）が読み込まれていません。ボタン操作の一部が制限されます。アプリのログを確認してください。');
    }

    NicoLiveHelper.init().catch( ( error ) => {
        console.error('[Init] Fatal startup error:', error);
        showStartupDiagnostic('初期化エラー: ' + (error && error.message ? error.message : String(error)));
    } );
} );
