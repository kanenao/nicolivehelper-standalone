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


var Config = {
    'play-default-volume': 50,
    'autoplay-interval': 10,
    'auto-enquete-enabled': false,
    'auto-enquete-delay': 60,
    'auto-enquete-duration': 30,
    'auto-enquete-repeat-tie': true,
    'auto-enquete-repeat-empty': true,
    'auto-enquete-auto-skip': true,
    'play-in-time': false,
    'auto-extend': false,
    'auto-start': false,
    'auto-start-quote': false,
    'auto-connect-on-start': true,
    'auto-open': false,
    'auto-close': false,
    'auto-create-next': false,
    'auto-close-livepage': false,

    /* スタートアップコメント（配信開始時の挨拶） */
    'startup-comment-enabled': false,
    'startup-comment-text': '配信を開始しました！本日の枠：{live-title}\nゆっくりしていってね！',
    'startup-comment-target': 'caster',
    'startup-comment-command': '',
    'startup-comment-interval': 5,
    'startup-comment-delay': 3,
    'startup-comment-expire-seconds': 180,

    'videoinfo-interval': 7,
    'vinfo-command-1': '',
    'vinfo-comment-1': '♪時間:{length} 再生数:{view} コメント:{comment} マイリスト:{mylist}',
    'vinfo-command-2': '',
    'vinfo-comment-2': '♪{id} {title} 投稿日:{date}',
    'vinfo-command-3': '',
    'vinfo-comment-3': '',
    'vinfo-command-4': '',
    'vinfo-comment-4': '',
    'pname-whitelist': '',

    'comment-184': false,
    'auto-kotehan': false,
    'comment-dispay-lines': 500,
    'comment-backlog-num': 50,

    'max-request': 0,
    'request-send-reply': false,
    'request-no-duplicated': false,
    'request-no-played': false,
    'request-allow-n-min-elapsed': 9999,
    'request-no-ngvideo': false,
    'request-broadcaster-name': '放送者',
    'request-anonymous-name': '匿名さん',
    'request-accept': '>>{comment_no} リクエストを受け付けました',
    'request-not-allow': '>>{comment_no} 現在リクエストを受け付けていません',
    'request-no-live-play': '>>{comment_no} 生放送で引用できない動画です',
    'request-deleted': '>>{comment_no} その動画は削除されているか、見つかりません',
    'request-duplicated': '>>{comment_no} リクエスト済みの動画です',
    'request-played': '>>{comment_no} 再生済みの動画です',
    'request-ngvideo': '>>{comment_no} NG動画です',
    'ng-video-list': '',
    'request-max-request': '>>{comment_no} リクエスト回数超過しています',


    /* Discord */
    'discord-on-play': false,
    'discord-webhook-url': '',
    // Discord に送るメッセージ。オプション画面は複数行入力に対応しており、改行をそのまま送信できます。
    // たとえば以下のように \n を入れておけば、実際には改行として扱われます。
    'discord-text': '再生中:{title}\nhttp://nico.ms/{id} #{id} http://nico.ms/{live-id}',
    'discord-on-request': false,
    'discord-request-text': 'リクエスト受付:{title}\nhttp://nico.ms/{id} #{id}',

    'do-speech': false,
    'do-speech-caster-comment': false,
    'webspeech-select-voice': 0,
    'webspeech-volume': 1.0,
    'webspeech-speed': 1.0,

    'tag-search-tag': '',
    'tag-search-targets': 'tagsExact',
    'tag-search-sort': '-startTime',
    'tag-search-limit': 10,
    'tag-search-auto-add': false,
    'tag-search-auto-trigger': 'stock-low',
    'tag-search-stock-threshold': 3,
    'tag-search-auto-interval': 15,
    'tag-search-prevent-duplicate': true
};
