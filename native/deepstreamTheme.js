/* DeepStream Pro by DGi Solutions. App-local colours, no server changes. */
(function () {
    'use strict';
    function applyTheme() {
        if (document.getElementById('deepstream-theme')) return;
        const style = document.createElement('style');
        style.id = 'deepstream-theme';
        style.textContent = `
            :root {
                --accent: #f1ba63;
                --accent-light: #ffdaa1;
                --primary-accent-color: #f1ba63;
                --theme-primary-color: #f1ba63;
            }
            body { color: #f4f0e9; }
            .skinHeader, .mainDrawer, .formDialogHeader, .formDialogFooter {
                background-color: #131313;
                color: #f4f0e9;
            }
            .dialog, .formDialog { background-color: #131313; color: #f4f0e9; }
            .emby-input, .emby-textarea, .emby-select-withcolor {
                background-color: #1b1a18;
                border-color: #34312b;
                color: #f4f0e9;
            }
            .emby-input:focus, .emby-textarea:focus, .emby-select-withcolor:focus {
                border-color: #f1ba63;
            }
            .button-submit, .btnPlay, .btnResume, .checkboxIcon-checked {
                background: linear-gradient(135deg, #ffdaa1, #f1ba63 48%, #bd8339);
                color: #090909;
            }
            .button-submit:hover, .btnPlay:hover, .btnResume:hover { background: #ffdaa1; }
            #itemDetailPage .mainDetailButtons .btnPlay:not(.hide) {
                width: 42px;
                height: 42px;
                min-width: 42px;
                min-height: 42px;
                padding: 0;
                margin: 0 .35rem;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 42px;
            }
            #itemDetailPage .mainDetailButtons .btnPlay .detailButton-content { padding: 0; }
            #itemDetailPage .mainDetailButtons .btnPlay .detailButton-icon { font-size: 23px; }
            .button-link, .textlink, .emby-tab-button-active, .emby-checkbox:checked + span + .checkboxOutline {
                color: #f1ba63;
            }
            .navMenuOption-selected { background-color: #30271b; color: #ffdaa1; }
            .mdl-slider-background-lower, .itemProgressBarForeground { background-color: #f1ba63; }
            .mdl-slider::-webkit-slider-thumb { background-color: #f1ba63; }
            .emby-button:focus-visible, .navMenuOption:focus-visible,
            .emby-input:focus-visible, .emby-select:focus-visible {
                outline: 2px solid #f1ba63;
                outline-offset: 3px;
            }
            .deepstream-credit {
                display: inline-flex;
                align-items: center;
                gap: .75rem;
                padding: .5rem;
                border: 0;
                border-radius: .35rem;
                background: transparent;
                color: #b5b1a9;
                cursor: pointer;
                font: inherit;
            }
            .deepstream-credit img { width: 128px; height: auto; }
            .deepstream-credit:focus-visible { outline: 2px solid #f1ba63; }
            .deepstream-settings-container {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .deepstream-settings {
                display: flex;
                flex-direction: column;
                position: relative;
                width: min(880px, 94vw);
                max-height: 90vh;
                border: 1px solid #34312b;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 18px 70px #000a;
            }
            .deepstream-settings .formDialogHeader { padding: 1rem 1.5rem; flex-shrink: 0; }
            .deepstream-settings .formDialogHeaderTitle { margin: .65rem 0 0; }
            .deepstream-settings .formDialogContent { overflow-y: auto; min-height: 0; padding: 1rem 1.5rem; }
            .deepstream-back {
                width: auto;
                padding: .45rem .75rem;
                border: 1px solid #34312b;
                border-radius: .35rem;
                background: #1b1a18;
                color: #f1ba63;
                font: inherit;
                cursor: pointer;
            }
            .deepstream-back:hover { background: #30271b; }
            .deepstream-back:focus-visible { outline: 2px solid #f1ba63; outline-offset: 3px; }
            .deepstream-settings .emby-select, .deepstream-settings .emby-input {
                display: block;
                width: 100%;
                font: inherit;
                padding: .6rem;
                border: 1px solid #34312b;
                border-radius: .35rem;
                margin-top: .5rem;
            }
            .deepstream-settings .formDialogFooter {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1rem;
                flex-wrap: wrap;
                padding: .75rem 1rem;
            }
            .deepstream-settings .formDialogFooter > .emby-button {
                width: auto;
                padding: .7rem 1.4rem;
                background: #f1ba63;
                color: #090909;
                border: 0;
                border-radius: .35rem;
                font: inherit;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyTheme, {once: true});
    else applyTheme();
})();
