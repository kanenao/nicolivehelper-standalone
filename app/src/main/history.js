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

var NicoLiveHistory = {
    history: [],    // 再生済み動画の リスト

    /**
     * 再生履歴に指定の動画があるかチェックする.
     * 複数同じ動画がある場合は最近再生した方を返す。
     * @param video_id
     * @returns {boolean|VideoInformation}
     */
    isExists: function( video_id ){
        let n = this.history.length;
        for( let i = n - 1; i >= 0; i-- ){
            let v = this.history[i];
            if( v.video_id == video_id ) return v;
        }
        return false;
    },

    /**
     * 再生履歴に動画を追加する.
     * @param vinfo{VideoInformation}
     */
    addHistory: function( vinfo ){
        let hist = $( '#txt-play-history' );
        let text = hist.val();
        let str = vinfo.video_id + "\t" + vinfo.title + "\n";
        hist.val( text + str );

        vinfo = CopyObject( vinfo );
        vinfo.play_time = GetCurrentTime();
        this.history.push( vinfo );

        this.save();

        let elem = this.createView( vinfo );
        $( '#tbl-play-history-body' ).append( elem );

        NicoLiveStock.setPlayed( vinfo.video_id );
    },

    /**
     * 再生履歴テキストに任意のテキストを追加する。
     * @param text
     */
    addHistoryText: function( text ){
        let hist = $( '#txt-play-history' );
        let history = hist.val();
        history += text;
        hist.val( history );

        this.save();
    },

    createView: function( vinfo ){
        let t = document.querySelector( '#template-history' );
        let clone2 = document.importNode( t.content, true );
        let elem = clone2.firstElementChild;
        elem.setAttribute( 'nico_video_id', vinfo.video_id );

        let thumbnail_image = elem.querySelector( '.nico-thumbnail' );
        let bitrate = elem.querySelector( '.nico-bitrate' );
        let title = elem.querySelector( '.nico-title' );
        let video_prop = elem.querySelector( '.nico-video-prop' );
        let link = elem.querySelector( '.nico-link' );
        let playtime = elem.querySelector( '.nico-playtime' );

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

        $( playtime ).text( `再生日時:${GetDateTimeString( vinfo.play_time * 1000, 1 )}` );

        return elem;
    },

    save: function(){
        if( !NicoLiveHelper.isCaster() ) return;

        let str = $( '#txt-play-history' ).val();
        browser.storage.local.set( {
            'history': str,
            'history_list': this.history
        } );
    },

    contextMenu: function( key, options ){
        let elem = options.$trigger[0];
        let n = elem.sectionRowIndex;

        switch( key ){
        case 'play':
            NicoLiveHelper.playVideo( this.history[n] );
            break;

        case 'copy':
            CopyToClipboard( this.history[n].video_id );
            break;

        case 'to_request':
            NicoLiveRequest.addRequestDirect( this.history[n] );
            break;

        case 'to_stock':
            NicoLiveStock.addStockDirect( this.history[n] );
            break;

        case 'copy_all':
            let str = "";
            for( let i = 0, item; item = this.history[i]; i++ ){
                str += item.video_id + " ";
            }
            CopyToClipboard( str );
            break;

        case 'profile':
            OpenLink( 'http://www.nicovideo.jp/user/' + this.history[n].user_id );
            break;

        case 'clear_stock_flag':
            NicoLiveStock.clearPlayedFlag( this.history[n].video_id );
            break;

        default:
            // マイリスト追加処理
            console.log( key );
            console.log( options.$trigger );
            let mylist_id = key.match( /^\d+_(.*)/ )[1];
            let video_id = this.history[n].video_id;
            // coxxx lvxxx xxx から登録
            let additional_msg = `${NicoLiveHelper.getCommunityId()} ${NicoLiveHelper.getLiveId()} ${NicoLiveHelper.getLiveTitle()} から登録`;
            if( options.metaKey || options.ctrlKey ){
                additional_msg = window.prompt( 'マイリストコメントを入力してください', additional_msg );
                additional_msg = additional_msg || '';
            }
            NicoLiveMylist.addMylist( mylist_id, video_id, additional_msg );
            break;
        }
        // console.log( options.$trigger );
    },

    init: async function(){
        if( NicoLiveHelper.isCaster() ){
            let obj = await browser.storage.local.get( 'history' );
            $( '#txt-play-history' ).val( obj.history );

            obj = await browser.storage.local.get( 'history_list' );
            if( obj.history_list ){
                this.history = obj.history_list;
            }
            for( let v of this.history ){
                let elem = this.createView( v );
                $( '#tbl-play-history-body' ).append( elem );
            }
        }

        let f = () => {
            let type = disptype.val();
            let views = [$( '#txt-play-history' ), $( '#tbl-play-history' )];
            views[type].show();
            views[1 - type].hide();
        };
        let disptype = $( '#sel-history-display-type' );
        disptype.on( 'change', ( ev ) => {
            f();
        } );
        f();

        $( '#btn-clear-history' ).on( 'click', ( ev ) => {
            this.history = [];
            $( '#tbl-play-history-body' ).empty();
            $( '#txt-play-history' ).val( '' );
            this.save();

            NicoLiveStock.clearAllPlayed();
        } );

        $( '#txt-play-history' ).on( 'change', ( ev ) => {
            this.save();
        } );

        // 再生履歴から動画IDのみをコピーする
        $( '#copy-history-text' ).on( 'click', ( ev ) => {
            let substring;
            let notes = $( '#txt-play-history' )[0];
            substring = notes.value.substr( notes.selectionStart, notes.selectionEnd - notes.selectionStart );

            if( substring.length >= 3 ){
                let video_ids = substring.match( /^(sm|nm|ze|so)\d+|\d{10}/mg );
                if( video_ids ){
                    CopyToClipboard( video_ids.join( ' ' ) );
                }
            }
        } );

        $.contextMenu( {
            selector: '#tbl-play-history-body .nico-video-row',
            build: function( $triggerElement, e ){
                let menuobj = {
                    zIndex: 10,
                    callback: function( key, options ){
                        NicoLiveHistory.contextMenu( key, options );
                    },
                    items: {
                        "play": {name: '再生する'},
                        "to_request": {name: 'リクエストに追加'},
                        "to_stock": {name: 'ストックに追加'},
                        "sep1": "---------",
                        "copy": {name: "動画IDをコピー"},
                        "copy_all": {name: "すべての動画IDをコピー"},
                        "add_mylist": {
                            name: "マイリストに追加",
                            items: {}
                        },
                        "sep2": "---------",
                        "profile": {name: "投稿者プロフィール"},
                        "sep3": "---------",
                        "clear_stock_flag": {name: 'ストックの再生済みフラグをクリア'}
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
    }
};

