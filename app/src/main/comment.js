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

var NicoLiveComment = {
    table: null,

    commentlog: [],    // コメントのログ(受信したもの全て記録)
    colormap: {},      // 配色マップ
    namemap: {},       // コテハンマップ
    reflectionmap: {},

    _namecache: {},

    saveFile: function(){
        let str = "";
        for( let item, i = 0; item = this.commentlog[i]; i++ ){
            let datestr = GetDateString( item.date * 1000, true );
            str += item.no + '\t' + item.user_id + '\t' + item.text + '\t' + datestr + "\r\n";
        }
        let name = `${NicoLiveHelper.liveProp.program.nicoliveProgramId}.txt`;
        SaveText( name, str );
    },

    addReflection: function( user_id, name, type, color ){
        console.log( `${user_id}をリフレクション登録 type=${type} color=${color}` );
        this.reflectionmap[user_id] = {
            'user_id': user_id,
            'name': name,
            'type': type,
            'color': color
        };
        UserManage.createTable();
    },
    removeReflection: function( user_id ){
        console.log( `${user_id}をリフレクション解除しました` );
        delete this.reflectionmap[user_id];
        UserManage.createTable();
    },

    /**
     * 指定ユーザーのコメントリフレクション登録をする.
     * @param user_id
     * @returns {Promise<void>}
     */
    addCommentReflection: async function( user_id ){
        if( !NicoLiveHelper.isCaster() ) return;

        let name = '★';
        if( user_id > 0 ){
            try{
                name = await this.getProfileName( user_id, '★' );
            }catch( e ){
                name = '★';
            }
        }

        let newname = await ShowPromptDialog(`ユーザー:${user_id}の表示名を入力してください`, name);
        if( newname ){
            this.addReflection( user_id, newname, 1 );
            UserManage.createTable();
        }
    },

    /**
     * 指定のユーザーIDのコテハンを返す.
     * コテハン設定がなければ空文字を返す.
     * @param user_id
     * @returns {*|string}
     */
    getKotehan: function( user_id ){
        return this.namemap[user_id] && this.namemap[user_id].name || "";
    },

    /**
     * コテハンを設定する。
     * @param user_id
     * @param name
     */
    setKotehan: function( user_id, name ){
        if( !name ) name = user_id;

        if( name != user_id ){
            this.namemap[user_id] = {
                "name": name,
                "time": GetCurrentTime()
            };
        }else{
            // delete this.namemap[user_id];
            this.namemap[user_id] = {};
        }
        console.log( `Kotehan(${user_id})=${name}` );

        $( `span[user_id="${user_id}"]` ).text( name );

        UserManage.createTable();
    },


    /**
     * プロフィールの名前を取得.
     * @param user_id ユーザーID
     * @param defname デフォルト名
     */
    getProfileName: function( user_id, defname ){
        let p = new Promise( ( resolve, reject ) => {
            let req = CreateXHR( 'GET', `https://api.live2.nicovideo.jp/api/v1/user/nickname?userId=${user_id}` );
            req.onreadystatechange = function(){
                if( req.readyState == 4 ){
                    if( req.status == 200 ){
                        try{
                            let text = req.responseText;
                            let data = JSON.parse( text );
                            resolve( data.data.nickname );
                        }catch( x ){
                            reject( '[Unknown]' )
                        }
                    }else{
                        reject( '[Unknown]' )
                    }
                }
            };
            req.send();
        } );
        return p;
    },

    /**
     * 自動コテハン登録
     */
    autoKotehan: async function( chat ){
        if( !Config['auto-kotehan'] ) return;
        if( chat.premium == 2 || chat.premium == 3 ) return;
        if( chat.date < NicoLiveHelper.connecttime ) return; // 過去ログ無視.

        let current_kotehan = this.getKotehan( chat.user_id );
        if( current_kotehan ) return;

        // ＠コテハン
        let dat = chat.text.match( /[@＠]([^0-9０-９\s@＠][^\s@＠]*?)$/ );
        if( dat ){
            let name = dat[1];
            if( name == "初見" || name == "確認" || name == "アンケート" ||
                name == "削除" || name == "代理" ) return;
            if( name == "○" || name == "×" || name == "△" ||
                name == "□" || name == "◎" ) return;
            this.setKotehan( chat.user_id, name );
            return;
        }

        if( chat.user_id.match( /^\d+$/ ) ){
            // ユーザIDから名前を取得.
            let name = await this.getProfileName( chat.user_id, chat.user_id );
            this.setKotehan( chat.user_id, name );
        }
    },

    /**
     * コメントリフレクションを実行する.
     * @param comment{Comment}
     */
    reflection: function( comment ){
        if( !NicoLiveHelper.isCaster() ) return;
        if( comment.date < NicoLiveHelper.connecttime ) return;
        if( !this.reflectionmap[comment.user_id] ) return;

        let name = this.reflectionmap[comment.user_id].name;
        let type = this.reflectionmap[comment.user_id].type;
        let color = this.reflectionmap[comment.user_id].color;
        let mail = '';
        let str = comment.text_notag;
        str = str.replace( /{=/g, '{-' );
        switch( parseInt( type ) ){
        case 0:
            // なし
            break;
        case 1:
            // 運営コメント
            NicoLiveHelper.postCasterComment( `${name}:${str}`, color, '', false );
            break;
        }
    },

    /**
     * コメント表示欄にコメントを追加する.
     * @param comment{Comment}
     */
    addComment: function( comment ){
        let table = this.table;
        if( !table ){
            return;
        }
        let body = table.tBodies[0] || table.createTBody();

        this.commentlog.push( comment );
        if (window.RemoteHostBridge && window.RemoteHostBridge.onCommentReceived) {
            window.RemoteHostBridge.onCommentReceived(comment);
        }

        // 表示行数に切り詰め
        const maxLines = Math.max( 1, parseInt(Config['comment-dispay-lines']) || 200 );
        if( body.rows.length >= maxLines ){
            body.deleteRow( body.rows.length - 1 );
        }

        let tr = body.insertRow( 0 );
        tr.setAttribute( "tr_comment_by", comment.user_id );

        // NGスコアによる透過
        if( comment.score <= -10000 ){
            // なし
            tr.setAttribute( "style", "color: #00000030;" );
        }else if( comment.score <= -4800 ){
            // 弱
            tr.setAttribute( "style", "color: #00000060;" );
        }else if( comment.score <= -1000 ){
            // 中
            tr.setAttribute( "style", "color: #00000090;" );
        }else if( comment.score < 0 ){
            // 強
            tr.setAttribute( "style", "color: #000000c0;" );
        }

        //----- 背景色の決定
        if( !this.colormap[comment.user_id] ){
            let sel = GetRandomInt( 1, 8 );
            let col = 'color' + sel;
            tr.className = col;
            this.colormap[comment.user_id] = {"color": col, "date": GetCurrentTime()};
        }else{
            let col = this.colormap[comment.user_id].color;
            if( col.indexOf( 'color' ) == 0 ){
                tr.className = col;
            }else{
                tr.style.backgroundColor = col;
            }
        }
        if( comment.premium == 2 || comment.premium == 3 || comment.premium == 7 ){
            tr.className = "color_caster";
        }

        let td;
        //----- コメント番号のセル
        td = tr.insertCell( tr.cells.length );
        td.textContent = comment.no;

        //----- 名前表示のセル
        td = tr.insertCell( tr.cells.length );
        if( comment.yourpost ){
            // 自分のコメントは名前を強調する
            $( td ).addClass( 'nico_yourpost' );
        }

        let str;
        // コメントにname属性があればその名前を使用する.コテハンより優先される.
        str = comment.name || this.namemap[comment.user_id] && this.namemap[comment.user_id].name || comment.user_id;
        str = htmlspecialchars( str );

        let span = document.createElement( 'span' );
        span.setAttribute( 'comment_by', comment.user_id );
        span.setAttribute( 'user_id', comment.user_id );
        span.setAttribute( 'comment_no', comment.no );
        span.setAttribute( 'class', 'comment_username' );
        span.setAttribute( 'title', str );
        span.appendChild( document.createTextNode( str ) );
        td.appendChild( span );

        //----- コメントボディのセル
        td = tr.insertCell( tr.cells.length );
        td.setAttribute( 'style', 'width:100%;' );
        str = comment.text_notag;
        str = htmlspecialchars( str );
        let tmp = str.split( /(sm\d+|nm\d+|\d{10}|&\w+;)/ );
        let i;
        // 長文を途中改行できるように<wbr>を埋め込む
        for( i = 0; i < tmp.length; i++ ){
            if( !tmp[i].match( /(sm\d+|nm\d+|\d{10}|&\w+;)/ ) ){
                tmp[i] = tmp[i].replace( /(.{35,}?)/g, "$1<wbr>" );
            }
        }
        str = tmp.join( "" );
        // AA用に改行表示
        str = str.replace( /(\r\n|\r|\n)/gm, "<br>" );

        // sm,nmにリンクを貼り付け.
        str = str.replace( /((sm|nm)\d+)/g,
            "<a target=\"_blank\" href=\"https://www.nicovideo.jp/watch/$1\">$1</a>" );
        if( comment.premium != 3 ){
            // 数字10桁にもリンク.
            if( !str.match( /(sm|nm)\d+/ ) ){
                str = str.replace( /(\d{10})/g, "<a target=\"_blank\" href=\"https://www.nicovideo.jp/watch/$1\">$1</a>" );
            }
        }
        try{
            $( td ).html( str );

            // 動画IDのサムネイル表示
            let links = td.querySelectorAll( 'a' );
            for( let i = 0, item; item = links[i]; i++ ){
                let addr = item.getAttribute( 'href' );
                let id = addr.match( /(sm|nm|so)\d+|\d{10}/ );
                if( id ){
                    item.addEventListener( 'mouseover', ( ev ) => {
                        NicoLiveHelper.showThumbnail( ev, id[0] );
                    } );
                    item.addEventListener( 'mouseout', ( ev ) => {
                        NicoLiveHelper.hideThumbnail();
                    } );
                }
            }

        }catch( x ){
            console.log( x );
            console.log( str );
        }

        //--- コメント日時のセル
        td = tr.insertCell( tr.cells.length );
        td.textContent = GetDateTimeString( comment.date * 1000 );

        // 現在の検索条件を新着コメントにも適用し、表示件数を更新する。
        const filter = document.getElementById('comment-filter');
        const query = filter ? String(filter.value || '').toLocaleLowerCase() : '';
        tr.hidden = !!query && !tr.textContent.toLocaleLowerCase().includes(query);
        const visibleCount = document.getElementById('comment-visible-count');
        if( visibleCount ){
            visibleCount.textContent = table.tBodies[0].querySelectorAll('tr:not([hidden])').length + ' 件';
        }

        // 自動コテハン
        this.autoKotehan( comment );

        if( comment.date >= NicoLiveHelper.connecttime ){
            let cmt = $( '#comment-view' );
            let y = cmt.scrollTop();
            if( y != 0 ){
                cmt.scrollTop( y + tr.clientHeight );
            }
        }
    },

    /**
     * コメントを送信する
     * @param comment
     * @param mail
     */
    sendCommentCore: function( comment, mail ){
        if( !comment ) return;
        mail = mail || '';

        console.log( `送信: ${comment} ${mail}` );

        let type = parseInt( $( '#type-of-comment' ).val() );
        let isPerm = false;

        switch( type ){
        case 0: // 主コメ
            if( comment.match( /^sm\d+$/ ) ){
                NicoLiveHelper.playVideoDirect( comment );
            }else{
                NicoLiveHelper.postCasterComment( comment, mail, '', isPerm );
            }
            break;

        case 1: // リスナーコメ
            NicoLiveHelper.sendComment( mail, comment );
            break;

        }
    },

    /**
     * コメントタブで送信ボタンを押したときの処理
     */
    sendComment: function(){
        let txt = $( '#txt-input-comment' )
        let comment = txt.val();
        let mail = $( '#comment-command' ).val();

        this.sendCommentCore( comment, mail );

        txt.val( '' );

        // 入力文字をオートコンプリートリストに登録
        let opt = document.createElement( 'option' );
        opt.setAttribute( 'value', comment );
        let tmp = document.querySelector( '#comment-autocomplete' );
        tmp.insertBefore( opt, tmp.firstChild );

        if( $( tmp ).children( 'option' ).length > 5 ){
            tmp.removeChild( tmp.lastChild );
        }
    },

    contextMenu: async function( key, options ){
        let $elem = options.$trigger;
        let user_id = $elem.attr( 'user_id' );

        switch( key ){
        case 'profile':
            OpenLink( `http://www.nicovideo.jp/user/${user_id}` );
            break;

        case 'set_reflection':
            this.addCommentReflection( user_id );
            break;

        case 'set_kotehan':
            let defvalue = '';
            try{
                defvalue = await this.getProfileName( user_id, this.getKotehan( user_id ) );
            }catch( e ){
            }
            let name = await ShowPromptDialog(`${user_id}のコテハンを設定`, defvalue); if (name !== null) this.setKotehan(user_id, name);
            break;

        default:
            console.log( key );
            console.log( options.$trigger );
            break;
        }
        // console.log( options.$trigger );
    },

    initUI: function(){
        $( '#btn-send-comment' ).on( 'click', ( ev ) => {
            this.sendComment();
        } );

        $( '#txt-input-comment' ).on( 'keydown', ( ev ) => {
            if( ev.keyCode == 13 ){
                this.sendComment();
            }
        } );

        $( '#comment-filter' ).on( 'input', ( ev ) => {
            const query = String(ev.target.value || '').toLocaleLowerCase();
            const rows = document.querySelectorAll('#comment-table tbody tr');
            let visible = 0;
            rows.forEach(row => {
                const match = !query || row.textContent.toLocaleLowerCase().includes(query);
                row.hidden = !match;
                if(match) visible++;
            });
            const count = document.getElementById('comment-visible-count');
            if(count) count.textContent = visible + ' 件';
        } );

        $( '#comment-scroll-bottom' ).on( 'click', () => {
            const view = document.getElementById('comment-view');
            if(view) view.scrollTop = 0;
        } );

        $.contextMenu( {
            selector: '#comment-table .comment_username',
            build: function( $triggerElement, e ){
                let user_id = $triggerElement.attr( 'user_id' );
                let menuobj = {
                    zIndex: 10,
                    callback: function( key, options ){
                        NicoLiveComment.contextMenu( key, options );
                    },
                    items: {
                        "user_id": {
                            name: `<span class="black">${$triggerElement.attr( 'comment_no' )}. ID=${($triggerElement).attr( 'user_id' )}</span>`,
                            disabled: true,
                            isHtmlName: true,
                            value: `${user_id}`
                        },
                        "set_kotehan": {
                            name: "コテハン設定"
                        },
                        "profile": {name: "プロフィールを開く"},
                        "set_reflection": {
                            name: "コメントリフレクション登録"
                        }
                    }
                };

                if( !(user_id > 0) ){
                    menuobj.items.profile.disabled = true;
                }
                return menuobj;
            },
        } );
    },

    init: function(){
        this.namemap = JSON.parse( localStorage.getItem( 'kotehan' ) ) || {};
        this.initUI();
        this.table = document.querySelector( '#comment-table' );
        if( this.table && !this.table.tBodies.length ) this.table.createTBody();
    },
    destroy: function(){
        let id;
        let now = GetCurrentTime();
        for( id in this.namemap ){
            if( id > 0 ) continue;
            // 1週間経った匿名ユーザーのものは削除.
            if( now - this.namemap[id].time > 7 * 24 * 60 * 60 ){
                delete this.namemap[id];
            }
        }
        localStorage.setItem( 'kotehan', JSON.stringify( this.namemap ) );
    }
};

window.addEventListener( "unload", ( ev ) => {
    NicoLiveComment.destroy();
}, false );
