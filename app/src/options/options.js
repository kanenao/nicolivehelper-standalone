
async function initAccountSettings() {
  const updateStatus = async () => {
    if (typeof window.stsen !== 'undefined' && window.stsen.getAccountStatus) {
      try {
        const status = await window.stsen.getAccountStatus();
        if (status && status.loggedIn) {
          $('#opt-account-status').text('ログイン中').css('color', '#28a745');
          const name = (status.user && status.user.nickname) || '';
          const id = (status.user && status.user.id) ? '(ID: ' + status.user.id + ')' : '';
          $('#opt-account-details').text(name + ' ' + id);
          $('#opt-btn-login').text('再ログイン');
          $('#opt-btn-logout').show();
        } else {
          $('#opt-account-status').text('未ログイン').css('color', '#dc3545');
          $('#opt-account-details').text('※ブラウザでログインしてください');
          $('#opt-btn-login').text('ログイン');
          $('#opt-btn-logout').hide();
        }
      } catch (e) {
        console.error('Failed to get account status:', e);
      }
    }
  };

  if (typeof window.stsen !== 'undefined') {
    $('#opt-btn-login').on('click', () => {
      window.stsen.openLoginWindow();
    });
    $('#opt-btn-logout').on('click', async () => {
      if (confirm('ニコニコからログアウトしますか？')) {
        await window.stsen.logout();
        updateStatus();
      }
    });
    window.stsen.onAccountStatusChanged(() => {
      updateStatus();
    });
    updateStatus();
  }
}

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



function LoadValue( key, config, defvalue ){
    if( config[key] != undefined ){
        document.querySelector( `#${key}` ).value = config[key];
    }else{
        document.querySelector( `#${key}` ).value = defvalue;
    }
}

function LoadBool( key, config, defvalue ){
    document.querySelector( `#${key}` ).checked = config[key] || defvalue;
}

function SaveValue( key, config ){
    config[key] = document.querySelector( `#${key}` ).value;
}

function SaveInt( key, config ){
    config[key] = parseInt( document.querySelector( `#${key}` ).value );
}

function SaveNumber( key, config ){
    config[key] = document.querySelector( `#${key}` ).value * 1;
}

function SaveBool( key, config, value ){
    config[key] = document.querySelector( `#${key}` ).checked;
}


let g_vinfokey = [
    "vinfo-command-1",
    "vinfo-comment-1",
    "vinfo-command-2",
    "vinfo-comment-2",
    "vinfo-command-3",
    "vinfo-comment-3",
    "vinfo-command-4",
    "vinfo-comment-4"
];

let g_vinfo_defvalue = [
    '',
    '♪時間:{length} 再生数:{view} コメント:{comment} マイリスト:{mylist}',
    '',
    '♪{id} {title} 投稿日:{date}',
    '',
    '',
    '',
    ''
];



/**
 * 設定をロードして画面に反映.
 * @returns {Promise<void>}
 */
async function LoadOptions(){
    let result = await browser.storage.local.get( 'config' );
    console.log( result );

    let config = result.config || {};

    /* リモートホスト設定 */
    LoadBool( 'remote-server-enabled', config, false );
    LoadValue( 'remote-server-port', config, 18767 );
    LoadValue( 'remote-server-password', config, '' );

    if (typeof window.stsen !== 'undefined' && window.stsen.getRemoteServerStatus) {
        window.stsen.getRemoteServerStatus().then(status => {
            if (status && status.running) {
                $('#opt-remote-server-status-badge').text(`稼働中 (ポート ${status.port})`).css('background', '#28a745');
            } else {
                $('#opt-remote-server-status-badge').text('停止中').css('background', '#6c757d');
            }
        });
    }

    /* 進行 */
    LoadValue( 'play-default-volume', config, Config['play-default-volume'] );
    LoadValue( 'autoplay-interval', config, Config['autoplay-interval'] );
    LoadBool( 'auto-enquete-enabled', config, Config['auto-enquete-enabled'] );
    LoadValue( 'auto-enquete-delay', config, Config['auto-enquete-delay'] );
    LoadValue( 'auto-enquete-duration', config, Config['auto-enquete-duration'] );
    LoadValue( 'auto-enquete-repeat-delay', config, Config['auto-enquete-repeat-delay'] );
    LoadValue( 'auto-enquete-result-display-duration', config, Config['auto-enquete-result-display-duration'] );
    LoadBool( 'auto-enquete-repeat-tie', config, Config['auto-enquete-repeat-tie'] );
    LoadBool( 'auto-enquete-repeat-empty', config, Config['auto-enquete-repeat-empty'] );
    LoadBool( 'auto-enquete-auto-skip', config, Config['auto-enquete-auto-skip'] );
    LoadBool( 'play-in-time', config, Config['play-in-time'] );
    LoadBool( 'auto-extend', config, Config['auto-extend'] );
    LoadBool( 'auto-start', config, Config['auto-start'] );
    LoadBool( 'auto-start-quote', config, Config['auto-start-quote'] );
    LoadBool( 'auto-connect-on-start', config, Config['auto-connect-on-start'] );
    LoadBool( 'auto-open', config, Config['auto-open'] );
    LoadBool( 'auto-close', config, Config['auto-close'] );
    LoadBool( 'auto-create-next', config, Config['auto-create-next'] );
    LoadBool( 'auto-close-livepage', config, Config['auto-close-livepage'] );

    /* スタートアップコメント（配信開始時の挨拶） */
    LoadBool( 'startup-comment-enabled', config, Config['startup-comment-enabled'] );
    LoadValue( 'startup-comment-target', config, Config['startup-comment-target'] );
    LoadValue( 'startup-comment-command', config, Config['startup-comment-command'] );
    LoadValue( 'startup-comment-delay', config, Config['startup-comment-delay'] );
    LoadValue( 'startup-comment-interval', config, Config['startup-comment-interval'] );
    LoadValue( 'startup-comment-expire-seconds', config, Config['startup-comment-expire-seconds'] );
    LoadValue( 'startup-comment-text', config, Config['startup-comment-text'] );

    /* リクエスト */
    LoadValue( 'max-request', config, Config['max-request'] );
    LoadBool( 'request-no-duplicated', config, Config['request-no-duplicated'] );
    LoadBool( 'request-no-played', config, Config['request-no-played'] );
    LoadBool( 'request-no-ngvideo', config, Config['request-no-ngvideo'] );
    LoadValue( 'request-allow-n-min-elapsed', config, Config['request-allow-n-min-elapsed'] );

    LoadBool( 'request-send-reply', config, Config['request-send-reply'] );
    LoadValue( 'request-broadcaster-name', config, Config['request-broadcaster-name'] );
    LoadValue( 'request-anonymous-name', config, Config['request-anonymous-name'] );
    LoadValue( 'request-accept', config, Config['request-accept'] );
    LoadValue( 'request-not-allow', config, Config['request-not-allow'] );
    LoadValue( 'request-no-live-play', config, Config['request-no-live-play'] );
    LoadValue( 'request-deleted', config, Config['request-deleted'] );
    LoadValue( 'request-duplicated', config, Config['request-duplicated'] );
    LoadValue( 'request-played', config, Config['request-played'] );
    LoadValue( 'request-ngvideo', config, Config['request-ngvideo'] );
    LoadValue( 'request-max-request', config, Config['request-max-request'] );

    LoadValue( 'ng-video-list', config, Config['ng-video-list'] );

    /* コメント */
    LoadBool( 'comment-184', config, false );
    LoadBool( 'auto-kotehan', config, false );
    LoadValue( 'comment-dispay-lines', config, 500 );
    LoadValue( 'comment-backlog-num', config, 50 );

    /* 動画情報 */
    LoadValue( 'videoinfo-interval', config, 7 );
    let i = 0;
    for( let k of g_vinfokey ){
        LoadValue( k, config, g_vinfo_defvalue[i] );
        i++;
    }
    LoadValue( 'pname-whitelist', config, '' );



    /* Discord */
    LoadBool( 'discord-on-play', config, Config['discord-on-play'] );
    LoadValue( 'discord-text', config, Config['discord-text'] );
    LoadBool( 'discord-on-request', config, Config['discord-on-request'] );
    LoadValue( 'discord-request-text', config, Config['discord-request-text'] );
    LoadValue( 'discord-webhook-url', config, '' );
    // make sure the helper knows the current URL right away
    if( config['discord-webhook-url'] ){
        Discord.webhookUrl = config['discord-webhook-url'];
    }

    $( '#btn-test-discord' ).on( 'click', ( ev ) => {
        // make sure a webhook URL has been entered before attempting to send
        let url = $( '#discord-webhook-url' ).val().trim();
        if( url === '' ){
            alert( 'Discord のウェブフック URL が設定されていません。送信するには URL を入力してください。' );
            return;
        }
        // update the Discord helper immediately so the test can use it
        Discord.webhookUrl = url;
        // also mirror it in the temporary config object so that SaveOptions will
        // pick it up (but we don't persist here yet).
        Config['discord-webhook-url'] = url;

        let text = $( '#txt-discord-test' ).val();
        Discord.updateStatus( text );
    } );

    /* コメント読み上げ */
    LoadBool( 'do-speech', config, Config['do-speech'] );
    LoadBool( 'do-speech-caster-comment', config, Config['do-speech-caster-comment'] );

    let voice_select = $( '#webspeech-select-voice' );
    // 音声キャラクタリストを作成
    this._webvoices = speechSynthesis.getVoices();
    for( let i = 0; i < this._webvoices.length; i++ ){
        let item = document.createElement( 'option' );
        item.setAttribute( 'value', i );
        item.appendChild( document.createTextNode( this._webvoices[i].name ) );
        voice_select.append( item );
    }
    LoadValue( 'webspeech-select-voice', config, Config['webspeech-select-voice'] );
    LoadValue( 'webspeech-volume', config, Config['webspeech-volume'] );
    LoadValue( 'webspeech-speed', config, Config['webspeech-speed'] );

    /* 指定タグ動画追加 */
    LoadValue( 'tag-search-tag', config, Config['tag-search-tag'] );
    LoadValue( 'tag-search-targets', config, Config['tag-search-targets'] );
    LoadValue( 'tag-search-sort', config, Config['tag-search-sort'] );
    LoadValue( 'tag-search-limit', config, Config['tag-search-limit'] );
    LoadBool( 'tag-search-prevent-duplicate', config, Config['tag-search-prevent-duplicate'] );
    LoadBool( 'tag-search-auto-add', config, Config['tag-search-auto-add'] );
    LoadValue( 'tag-search-auto-trigger', config, Config['tag-search-auto-trigger'] );
    LoadValue( 'tag-search-stock-threshold', config, Config['tag-search-stock-threshold'] );
    LoadValue( 'tag-search-auto-interval', config, Config['tag-search-auto-interval'] );

    refreshAllMacroPreviews();
}

function SaveOptions( ev ){
    ev.preventDefault();
    console.log( 'save settings' );

    let config = {};

    /* リモートホスト設定 */
    SaveBool( 'remote-server-enabled', config );
    SaveInt( 'remote-server-port', config );
    SaveValue( 'remote-server-password', config );

    /* 進行 */
    SaveInt( 'play-default-volume', config );
    SaveInt( 'autoplay-interval', config );
    SaveBool( 'auto-enquete-enabled', config );
    SaveInt( 'auto-enquete-delay', config );
    SaveInt( 'auto-enquete-duration', config );
    SaveInt( 'auto-enquete-repeat-delay', config );
    SaveInt( 'auto-enquete-result-display-duration', config );
    SaveBool( 'auto-enquete-repeat-tie', config );
    SaveBool( 'auto-enquete-repeat-empty', config );
    SaveBool( 'auto-enquete-auto-skip', config );
    SaveBool( 'play-in-time', config );
    SaveBool( 'auto-extend', config );
    SaveBool( 'auto-start', config );
    SaveBool( 'auto-start-quote', config );
    SaveBool( 'auto-connect-on-start', config );
    SaveBool( 'auto-open', config );
    SaveBool( 'auto-close', config );
    SaveBool( 'auto-create-next', config );
    SaveBool( 'auto-close-livepage', config );

    /* スタートアップコメント（配信開始時の挨拶） */
    SaveBool( 'startup-comment-enabled', config );
    SaveValue( 'startup-comment-target', config );
    SaveValue( 'startup-comment-command', config );
    SaveInt( 'startup-comment-delay', config );
    SaveInt( 'startup-comment-interval', config );
    SaveInt( 'startup-comment-expire-seconds', config );
    SaveValue( 'startup-comment-text', config );

    /* リクエスト */
    SaveInt( 'max-request', config );
    SaveBool( 'request-no-duplicated', config );
    SaveBool( 'request-no-played', config );
    SaveBool( 'request-no-ngvideo', config );
    SaveInt( 'request-allow-n-min-elapsed', config );

    SaveBool( 'request-send-reply', config );
    SaveValue( 'request-broadcaster-name', config );
    SaveValue( 'request-anonymous-name', config );
    SaveValue( 'request-accept', config );
    SaveValue( 'request-not-allow', config );
    SaveValue( 'request-no-live-play', config );
    SaveValue( 'request-deleted', config );
    SaveValue( 'request-duplicated', config );
    SaveValue( 'request-played', config );
    SaveValue( 'request-ngvideo', config );
    SaveValue( 'request-max-request', config );

    SaveValue( 'ng-video-list', config );

    /* コメント */
    SaveBool( 'comment-184', config );
    SaveBool( 'auto-kotehan', config );
    SaveInt( 'comment-dispay-lines', config );
    SaveInt( 'comment-backlog-num', config );

    /* 動画情報 */
    SaveInt( 'videoinfo-interval', config );
    for( let k of g_vinfokey ){
        SaveValue( k, config );
    }
    SaveValue( 'pname-whitelist', config );


    /* Discord */
    SaveBool( 'discord-on-play', config );
    SaveValue( 'discord-webhook-url', config );
    SaveValue( 'discord-text', config );
    SaveBool( 'discord-on-request', config );
    SaveValue( 'discord-request-text', config );

    /* コメント読み上げ */
    SaveBool( 'do-speech', config );
    SaveBool( 'do-speech-caster-comment', config );
    SaveValue( 'webspeech-select-voice', config );
    SaveNumber( 'webspeech-volume', config );
    SaveNumber( 'webspeech-speed', config );

    /* 指定タグ動画追加 */
    SaveValue( 'tag-search-tag', config );
    SaveValue( 'tag-search-targets', config );
    SaveValue( 'tag-search-sort', config );
    SaveInt( 'tag-search-limit', config );
    SaveBool( 'tag-search-prevent-duplicate', config );
    SaveBool( 'tag-search-auto-add', config );
    SaveValue( 'tag-search-auto-trigger', config );
    SaveInt( 'tag-search-stock-threshold', config );
    SaveInt( 'tag-search-auto-interval', config );

    browser.storage.local.set( {
        'config': config
    } );

    if (typeof window.stsen !== 'undefined' && window.stsen.updateRemoteServerConfig) {
        window.stsen.updateRemoteServerConfig({
            enabled: config['remote-server-enabled'],
            port: config['remote-server-port'],
            password: config['remote-server-password']
        }).then(status => {
            if (status && status.running) {
                $('#opt-remote-server-status-badge').text(`稼働中 (ポート ${status.port})`).css('background', '#28a745');
            } else {
                $('#opt-remote-server-status-badge').text('停止中').css('background', '#6c757d');
            }
        });
    }
}

window.addEventListener( 'load', async function( ev ){
    Talker.init();

    LoadOptions();
    initAccountSettings();

    $( '#btn-test-talk' ).on( 'click', ( ev ) => {
        let text = $( '#webspeech-test-text' ).val();
        let select = $( '#webspeech-select-voice' );
        let n = select.get( 0 ).selectedIndex;
        let vol = $( '#webspeech-volume' ).val() * 1;
        let spd = $( '#webspeech-speed' ).val() * 1;

        Talker.speech2( text, n, vol, spd );
    } );

    $( '#btn-save-config' ).on( 'click', ( ev ) => {
        SaveOptions( ev );
    } );

    $( '#btn-open-config-folder' ).on( 'click', () => {
        if ( window.stsen && window.stsen.openConfigFolder ) {
            window.stsen.openConfigFolder();
        }
    } );

    const handleResetAllData = () => {
        if ( window.stsen && window.stsen.resetAllData ) {
            window.stsen.resetAllData();
        }
    };
    $( '#btn-reset-all-data' ).on( 'click', handleResetAllData );
    $( '#btn-reset-all-data-bottom' ).on( 'click', handleResetAllData );

    $( '#opt-version-badge' ).on( 'click', () => {
        if ( window.stsen && window.stsen.showAboutDialog ) {
            window.stsen.showAboutDialog();
        } else if ( typeof browser !== 'undefined' && browser.runtime && browser.runtime.getManifest ) {
            const manifest = browser.runtime.getManifest();
            alert( `${manifest.name || 'New NicoLive Helper'}\nバージョン: v${manifest.version}` );
        }
    } );

    if ( typeof window.stsen !== 'undefined' && window.stsen.getVersion ) {
        const v = window.stsen.getVersion();
        $( '.app-version-text' ).text( v.startsWith('v') ? v : 'v' + v );
    }

    initMacroHelpers();
} );

/* ==========================================================================
   マクロ（プレースホルダー）入力支援ロジック
   ========================================================================== */

const SAMPLE_MACRO_DATA = {
    video: {
        video_id: 'sm1715919',
        title: 'メルト',
        first_retrieve: 1197019440, // 2007/12/07 18:24
        length: '04:15',
        view_counter: 14235100,
        comment_num: 3580210,
        mylist_counter: 450120,
        tags: { jp: ['VOCALOID', '初音ミク', 'メルト', 'ryo', 'ミクオリジナル曲', '伝説のVOCALOIDマスター'] },
        user_nickname: 'ryo',
        description: 'ryoです。今回は初音ミクにオリジナルの曲を歌ってもらいました。本家様→sm1715919',
        comment_no: 128,
        mylistcomment: '言わずと知れた名曲！'
    },
    live: {
        id: 'lv345678901',
        title: '【テスト配信】ボカロ名曲枠',
        endTime: '2026/09/16 18:00'
    },
    counts: {
        requestnum: 3,
        requesttime: '00:12:30',
        stocknum: 8,
        stocktime: '00:35:10',
        reqAllowed: true
    }
};

/**
 * マクロ文字列をサンプルデータで展開
 */
function previewMacroString( str ){
    if( !str ) return '';
    const v = SAMPLE_MACRO_DATA.video;
    const l = SAMPLE_MACRO_DATA.live;
    const c = SAMPLE_MACRO_DATA.counts;

    const replacefunc = function( s, p ){
        let tmp = s;
        if( p.match( /^reqstat:(.*?):(.*?)$/ ) ){
            let msgs = [RegExp.$1, RegExp.$2];
            return c.reqAllowed ? msgs[0] : msgs[1];
        }
        switch( p ){
            case 'id': return v.video_id;
            case 'title': return v.title;
            case 'date': return typeof GetDateString === 'function' ? GetDateString( v.first_retrieve * 1000, true ) : '2007/12/07 18:24';
            case 'length': return v.length;
            case 'view': return typeof FormatCommas === 'function' ? FormatCommas( v.view_counter ) : '14,235,100';
            case 'comment': return typeof FormatCommas === 'function' ? FormatCommas( v.comment_num ) : '3,580,210';
            case 'mylist': return typeof FormatCommas === 'function' ? FormatCommas( v.mylist_counter ) : '450,120';
            case 'mylistrate': return (100 * v.mylist_counter / v.view_counter).toFixed( 1 ) + '%';
            case 'tags': return v.tags.jp.join( '　' ).replace( /(.{35,}?)　/g, "$1\n" );
            case 'username': return v.user_nickname;
            case 'pname': return 'ryo(supercell)';
            case 'description': return v.description.slice( 0, 40 );
            case 'comment_no': return v.comment_no;
            case 'requestnum': return c.requestnum;
            case 'requesttime': return c.requesttime;
            case 'stocknum': return c.stocknum;
            case 'stocktime': return c.stocktime;
            case 'mylistcomment': return v.mylistcomment;
            case 'pref:min-ago': return 5;
            case 'end-time': return l.endTime;
            case 'live-id': return l.id;
            case 'live-title': return l.title;
            default: return s;
        }
    };

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
}

/**
 * 文字数と全角・半角換算文字数を計算
 */
function getCharCounts( str ){
    if( !str ) return { chars: 0, halfWidthEquivalent: 0 };
    let len = str.length;
    let byteLen = 0;
    for (let i = 0; i < len; i++) {
        const code = str.charCodeAt(i);
        if ((code >= 0x0 && code < 0x81) || (code === 0xf8f0) || (code >= 0xff61 && code < 0xffa0) || (code >= 0xf8f1 && code < 0xf8f4)) {
            byteLen += 1;
        } else {
            byteLen += 2;
        }
    }
    return {
        chars: len,
        halfWidthEquivalent: byteLen
    };
}

const lastFocusedMacroInputs = {
    startup: null,
    vinfo: null,
    request: null,
    discord: null
};

/**
 * プレビュー枠を更新
 */
function updateMacroPreview( group, inputElem ){
    if( !inputElem ) return;
    const $elem = $( inputElem );
    const groupName = group || $elem.data( 'macro-group' );
    if( !groupName ) return;

    lastFocusedMacroInputs[groupName] = inputElem;

    const labelName = $elem.data( 'macro-name' ) || inputElem.placeholder || inputElem.id;
    $( `#${groupName}-preview-target` ).text( labelName );

    const val = $elem.val() || '';
    const previewed = previewMacroString( val );
    $( `#${groupName}-preview-content` ).text( previewed || '(未入力)' );

    const counts = getCharCounts( previewed );
    const countText = `${counts.chars}文字 (半角${counts.halfWidthEquivalent}字 / 全角約${Math.ceil(counts.halfWidthEquivalent / 2)}字)`;
    const $charCount = $( `#${groupName}-char-count` );
    $charCount.text( countText );

    const isCasterStartup = groupName === 'startup' && $( '#startup-comment-target' ).val() === 'caster';
    if( (groupName === 'vinfo' || isCasterStartup) && counts.halfWidthEquivalent > 80 ){
        $charCount.addClass( 'warning' ).attr( 'title', '⚠️ 主コメ推奨(半角80/全角40文字)を超過しています' );
    } else {
        $charCount.removeClass( 'warning' ).removeAttr( 'title' );
    }
}

/**
 * 全グループのプレビューを更新
 */
function refreshAllMacroPreviews(){
    const defaultTargets = [
        { group: 'startup', id: '#startup-comment-text' },
        { group: 'vinfo', id: '#vinfo-comment-1' },
        { group: 'request', id: '#request-accept' },
        { group: 'discord', id: '#discord-text' }
    ];
    for( const item of defaultTargets ){
        const elem = lastFocusedMacroInputs[item.group] || $( item.id ).get( 0 );
        if( elem ){
            updateMacroPreview( item.group, elem );
        }
    }
}

/**
 * マクロタグを現在の対象入力欄のカーソル位置に挿入
 */
function insertMacroTag( group, tag ){
    let target = lastFocusedMacroInputs[group];
    if( !target ){
        target = $( `.macro-input[data-macro-group="${group}"]` ).get( 0 );
    }
    if( !target ) return;

    const startPos = target.selectionStart != null ? target.selectionStart : target.value.length;
    const endPos = target.selectionEnd != null ? target.selectionEnd : target.value.length;
    const oldVal = target.value;
    target.value = oldVal.substring( 0, startPos ) + tag + oldVal.substring( endPos );
    
    target.selectionStart = target.selectionEnd = startPos + tag.length;
    target.focus();

    updateMacroPreview( group, target );
}

/**
 * マクロ入力支援UIの初期化
 */
function initMacroHelpers(){
    // タグチップおよびテーブル内タグのクリック
    $( document ).on( 'click', '.macro-chip, .macro-table-tag', function( ev ){
        ev.preventDefault();
        const tag = $( this ).data( 'tag' );
        const $panel = $( this ).closest( '.macro-helper-panel' );
        const group = $panel.data( 'group' );
        if( group && tag ){
            insertMacroTag( group, tag );
        }
    } );

    // マクロ入力欄のフォーカスおよび入力イベント
    $( document ).on( 'focus input', '.macro-input', function( ev ){
        const group = $( this ).data( 'macro-group' );
        updateMacroPreview( group, this );
    } );

    $( document ).on( 'change', '#startup-comment-target', function(){
        updateMacroPreview( 'startup', $( '#startup-comment-text' ).get( 0 ) );
    } );

    // 初期プレビュー表示
    setTimeout( () => {
        refreshAllMacroPreviews();
    }, 150 );
}

