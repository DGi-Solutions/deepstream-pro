/* DeepStream Pro by DGi Solutions. App-local colours, no server changes. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else factory().install(root);
})(typeof window === 'object' ? window : null, function () {
    'use strict';
    function applyHeaderBranding(doc, logoUrl) {
        if (!logoUrl) return;
        for (const image of doc.querySelectorAll('.MuiToolbar-root a.MuiButton-root .MuiButton-startIcon img')) {
            const link = image.closest('a');
            if (!link) continue;
            if (image.getAttribute('src') !== logoUrl) image.setAttribute('src', logoUrl);
            if (!link.classList.contains('deepstream-server-brand')) link.classList.add('deepstream-server-brand');
            for (const child of link.childNodes) {
                if (child.nodeType === 3 && child.nodeValue.trim() && child.nodeValue !== 'DeepStream Pro') child.nodeValue = 'DeepStream Pro';
            }
        }
        for (const node of doc.querySelectorAll('.skinHeader .pageTitleWithLogo, .skinHeader .pageTitleWithDefaultLogo, .skinHeader .headerLogo')) {
            if (node.parentElement?.closest('.deepstream-brand')) continue;
            const existing = node.querySelector('.deepstream-brand-mark');
            if (existing?.getAttribute('src') === logoUrl && node.querySelector('.deepstream-brand-name')?.textContent === 'DeepStream Pro') continue;
            const mark = doc.createElement('img');
            mark.className = 'deepstream-brand-mark';
            mark.setAttribute('src', logoUrl);
            mark.setAttribute('alt', '');
            mark.setAttribute('aria-hidden', 'true');
            const name = doc.createElement('span');
            name.className = 'deepstream-brand-name';
            name.textContent = 'DeepStream Pro';
            node.classList.add('deepstream-brand');
            node.style.setProperty('background-image', 'none', 'important');
            node.removeAttribute('aria-hidden');
            node.setAttribute('aria-label', 'DeepStream Pro');
            node.replaceChildren(mark, name);
        }
    }
    function install(win) {
    const document = win.document;
    function applyTheme() {
        if (document.getElementById('deepstream-theme')) return true;
        if (!document.head) return false;
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
            .deepstream-audio-details {
                margin: 1.1rem 0 1.4rem;
                padding: 1rem 1.2rem;
                border: 1px solid #34312b;
                border-radius: .65rem;
                background: #131313;
                color: #f4f0e9;
                font-size: .9rem;
            }
            .deepstream-audio-heading { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
            .deepstream-audio-heading h3 { margin: 0; font-size: 1.1rem; font-weight: 650; }
            .deepstream-audio-badge { padding: .25rem .6rem; border-radius: .35rem; background: #30271b; color: #ffdaa1; }
            .deepstream-audio-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: .85rem 1.2rem; margin: 1rem 0; }
            .deepstream-audio-grid dt { color: #b5b1a9; font-size: .82em; margin-bottom: .2rem; }
            .deepstream-audio-grid dd { margin: 0; font-weight: 550; overflow-wrap: anywhere; }
            .deepstream-audio-route { padding-top: .75rem; border-top: 1px solid #34312b; }
            .deepstream-audio-route strong { color: #ffdaa1; }
            .deepstream-audio-route p { margin: .35rem 0; }
            .deepstream-audio-route small { display: block; margin-top: .6rem; color: #b5b1a9; }
            .deepstream-audio-details details { margin-top: 1rem; }
            .deepstream-audio-details summary { cursor: pointer; color: #f1ba63; }
            .deepstream-audio-details li { margin: .45rem 0; }
            .deepstream-spatial-control { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #34312b; }
            .deepstream-spatial-toggle { display: flex; align-items: center; gap: .65rem; cursor: pointer; }
            .deepstream-spatial-toggle input { accent-color: #e7b567; width: 1.1rem; height: 1.1rem; }
            .deepstream-spatial-toggle input:focus-visible { outline: 2px solid #f1ba63; outline-offset: 3px; }
            .deepstream-spatial-experimental { color: #c8a875; font-size: .8em; }
            .deepstream-spatial-scope, .deepstream-spatial-hint, .deepstream-spatial-status { display: block; margin-top: .45rem; color: #aaa49b; line-height: 1.4; }
            .deepstream-spatial-hint:not(:empty), .deepstream-spatial-status:not(:empty) { color: #e3c18e; }
            .deepstream-audio-enhancements { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #34312b; }
            .deepstream-enhancement-heading, .deepstream-enhancement-footer,
            .deepstream-enhancement-control-label { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
            .deepstream-enhancement-toggle { display: inline-flex; align-items: center; gap: .6rem; cursor: pointer; }
            .deepstream-enhancement-toggle input { accent-color: #f1ba63; width: 1.1rem; height: 1.1rem; margin: 0; }
            .deepstream-enhancement-status { font-size: .82rem; color: #b5b1a9; text-align: right; }
            .deepstream-enhancement-status[data-active="true"] { color: #ffdaa1; }
            .deepstream-enhancement-controls { border: 0; padding: 0; margin: .9rem 0 0; min-width: 0; }
            .deepstream-enhancement-controls:disabled { opacity: .5; }
            .deepstream-enhancement-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem 1.6rem; margin-top: 1rem; }
            .deepstream-enhancement-control { display: flex; flex-direction: column; gap: .45rem; min-width: 0; font-size: .85rem; }
            .deepstream-enhancement-control output { color: #c7b18e; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .deepstream-enhancement-control input[type="range"] { width: 100%; margin: .2rem 0; accent-color: #f1ba63; }
            .deepstream-enhancement-footer { margin-top: 1rem; }
            .deepstream-enhancement-footer small, .deepstream-enhancement-saved { color: #b5b1a9; font-size: .78rem; }
            .deepstream-enhancement-footer button { font: inherit; font-size: .8rem; color: #ffdaa1; background: #24211c; border: 1px solid #41382b; border-radius: .45rem; padding: .4rem .65rem; cursor: pointer; }
            .deepstream-enhancement-saved { display: block; margin-top: .5rem; }
            .deepstream-audio-enhancements :focus-visible { outline: 2px solid #f1ba63; outline-offset: 3px; }
            @media (max-width: 560px) {
                .deepstream-enhancement-grid { grid-template-columns: 1fr; }
                .deepstream-enhancement-heading { align-items: flex-start; }
                .deepstream-enhancement-footer { align-items: flex-start; flex-wrap: wrap; }
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
            html body .MuiAppBar-root { background: #101010e8 !important; backdrop-filter: blur(22px); box-shadow: none; border-bottom: 1px solid #ffffff0b; }
            /* The navigation remains intact; only its divider is suppressed while video is present. */
            html:has(.videoPlayerContainer) body .MuiAppBar-root,
            html:has(.videoPlayerContainer) body .skinHeader {
                border-bottom: 0 !important;
                box-shadow: none !important;
            }
            html body .MuiToolbar-root { min-height: 60px; gap: 4px; }
            html body .MuiToolbar-root .MuiButton-root { font-size: 14px; text-transform: none; border-radius: 9px; }
            html body .MuiToolbar-root .MuiButton-textPrimary { color: #e8bf80; background: #e8bf800b; }
            html body .MuiToolbar-root .MuiAvatar-root { background-color: #34291b; color: #edc68e; }
            html body .MuiToolbar-root .deepstream-server-brand { font-size: 17px; font-weight: 650; letter-spacing: -.3px; margin-right: 15px; padding-left: 0; }
            html body .deepstream-server-brand .MuiButton-startIcon { margin-right: 10px; }
            html body .deepstream-server-brand .MuiButton-startIcon img { width: 32px !important; height: 32px !important; max-height: 32px !important; max-width: 32px !important; border-radius: 8px; }
            html body .skinHeader .deepstream-brand { display: inline-flex; align-items: center; gap: 10px; width: auto !important; height: 40px !important; background: none !important; }
            html body .skinHeader .deepstream-brand::before, html body .skinHeader .deepstream-brand::after { display: none !important; content: none !important; }
            .deepstream-brand-mark { width: 32px; height: 32px; border-radius: 8px; }
            .deepstream-brand-name { font: 650 17px -apple-system, sans-serif; }
            html body .itemProgressBarForeground { background: #e8bf80 !important; }
            html body:has(#itemDetailPage.deepstream-media-page:not(.hide)) .backdropContainer, html body:has(#itemDetailPage:not(.hide) .trackSelections:not(.hide) .selectVideo option) .backdropContainer { visibility: hidden !important; }
            html body #itemDetailPage:not(.deepstream-person-page) { isolation: isolate; background: #090909 !important; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
            html body #itemDetailPage:not(.deepstream-person-page) > .detailLogo, html body #itemDetailPage:not(.deepstream-person-page) #itemBackdrop { display: none !important; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-film-art { position: absolute; inset: 0 0 auto; z-index: 0; height: 560px; background-position: center 25%; background-size: cover; background-repeat: no-repeat; pointer-events: none; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-film-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg,#090909c9, #09090930 75%),linear-gradient(0deg,#090909 1%,#09090922 70%,#09090933); }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-secondary-art { position: absolute; top: 560px; left: 0; right: 0; height: 0; z-index: 0; background-size: cover; background-position: center top; background-repeat: no-repeat; pointer-events: none; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-secondary-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg,#090909 0%,#09090988 20%,#09090977 80%,#090909 100%),linear-gradient(90deg,#09090966,#09090922); }
            html body #itemDetailPage:not(.deepstream-person-page) .detailPageWrapperContainer { position: relative; z-index: 1; background: transparent; max-width: 1380px; width: 100%; margin: 0 auto; padding: 0 clamp(26px,4vw,60px) 60px; box-sizing: border-box; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailPagePrimaryContainer { display: block; margin: 0; padding: 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailPagePrimaryContainer > .detailImageContainer, html body #itemDetailPage:not(.deepstream-person-page) .infoWrapper > .detailImageContainer { display: none !important; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailRibbon { position: relative; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; gap: 20px; min-height: 320px; height: auto; margin: 0; padding: 105px 0 32px !important; box-sizing: border-box; background: transparent !important; }
            html body #itemDetailPage:not(.deepstream-person-page) .infoWrapper { margin: 0; padding: 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .nameContainer { margin: 0 0 12px; padding: 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .nameContainer h1, html body #itemDetailPage:not(.deepstream-person-page) .nameContainer h2, html body #itemDetailPage:not(.deepstream-person-page) .nameContainer .itemName { font-size: clamp(32px,3.7vw,48px); font-weight: 700; letter-spacing: -1.3px; line-height: 1.1; margin: 0; text-shadow: 0 2px 20px #0005; }
            html body #itemDetailPage:not(.deepstream-person-page) .itemMiscInfo { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 13px; color: #d0cdc6; line-height: 1.6; margin: 0 !important; }
            html body #itemDetailPage:not(.deepstream-person-page) .mainDetailButtons { display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 9px; margin: 0; padding: 0; height: auto; }
            html body #itemDetailPage:not(.deepstream-person-page) .mainDetailButtons .detailButton:not(.hide) { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; min-width: 40px; min-height: 40px; flex: 0 0 40px; padding: 0; margin: 0; border-radius: 50%; background: #ffffff14; border: 0; box-shadow: none; }
            html body #itemDetailPage:not(.deepstream-person-page) .mainDetailButtons .btnPlay:not(.hide) { width: 44px; height: 44px; min-width: 44px; min-height: 44px; flex-basis: 44px; color: #181108; background: linear-gradient(135deg,#ffdaa1,#efbd72 55%,#c28b43); }
            html body #itemDetailPage:not(.deepstream-person-page) .detailButton-content { padding: 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailButton-icon { font-size: 21px; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailPagePrimaryContent { position: relative; width: 100%; max-width: none; margin: 0; padding: 12px 0 0 !important; box-sizing: border-box; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailSection { display: block; width: 100%; margin: 0; padding: 0; }
            html body #itemDetailPage:not(.deepstream-person-page).deepstream-film-page .detailSection { display: grid; grid-template-columns: minmax(0,1.5fr) minmax(240px,.8fr); gap: 0 36px; align-items: start; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections:not(.hide) { grid-area: tracks; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); align-items: start; align-content: start; gap: 14px 18px; width: 100%; max-width: none !important; height: auto !important; min-height: 0; padding: 22px; margin: 0 !important; box-sizing: border-box; background: #171717eb; border: 1px solid #ffffff12; border-radius: 14px; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections::before { content: attr(data-deepstream-playback-label); grid-column: 1 / -1; font-size: 16px; font-weight: 650; margin-bottom: 2px; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .trackSelectionFieldContainer:not(.hide) { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; align-self: start; gap: 7px; width: 100%; max-width: none !important; min-width: 0; height: auto; min-height: 0; margin: 0 !important; padding: 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectSourceContainer { grid-column: 1 / -1; order: 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectVideoContainer { order: 1; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectSubtitlesContainer { order: 2; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectAudioContainer { order: 3; grid-column: 1 / -1; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectContainer .selectLabel { display: block; position: static; flex: 0 0 auto !important; flex-basis: auto !important; width: auto; height: auto; min-height: 0; margin: 0 !important; padding: 0; color: #a5a29b; font-size: 12px; line-height: 1.3; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectContainer .detailTrackSelect { display: block; flex: 0 0 auto; width: 100%; min-width: 0; max-width: 100%; height: 40px; min-height: 40px; padding: 9px 30px 9px 11px !important; margin: 0; border: 1px solid #ffffff12 !important; border-radius: 8px; background: #252525 !important; color: #e9e5de !important; font: 400 13px/1.4 -apple-system,sans-serif; appearance: none; -webkit-appearance: none; box-sizing: border-box; text-overflow: ellipsis; white-space: nowrap; opacity: 1; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectArrowContainer { position: absolute; top: auto; bottom: 10px; right: 9px; height: 20px; font-size: 14px; color: #b3aca0; }
            html body #itemDetailPage:not(.deepstream-person-page) .trackSelections .selectContainer .selectArrowContainer .selectArrow { margin: 0; font-size: 20px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-media-details { width: 100%; min-width: 0; max-width: none; box-sizing: border-box; margin: 0; padding: 22px; background: #171717eb; border: 1px solid #ffffff12; border-radius: 14px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-heading { gap: 9px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-heading h3 { font-size: 15px; letter-spacing: -.2px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-badge { font-size: 11px; padding: 4px 7px; border-radius: 5px; background: #d1ad7315; color: #e2c18f; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-grid { grid-template-columns: repeat(4,minmax(0,1fr)); gap: 17px 12px; margin: 20px 0; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-grid dt { font-size: 11px; line-height: 1.4; margin-bottom: 5px; color: #a5a29b; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-grid dd { font-size: 12px; font-weight: 550; line-height: 1.5; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-route { padding-top: 16px; border-top-color: #ffffff12; }
            .deepstream-audio-route-heading { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-route strong { color: #e9e5de; font-size: 12px; }
            .deepstream-audio-decoder { color: #aaa69e; font-size: 11px; }
            .deepstream-audio-route-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 13px; }
            .deepstream-audio-route-label { display: block; color: #a5a29b; font-size: 11px; margin-bottom: 5px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-route p { margin: 0; font-size: 12px; line-height: 1.5; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-route small { color: #8d8982; font-size: 10px; margin-top: 14px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-details details { border-top: 1px solid #ffffff12; margin-top: 17px; padding-top: 14px; }
            html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-details summary { color: #d9bc91; font-size: 12px; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailSectionContent { grid-area: synopsis; margin: 0 0 24px; padding: 0; color: #c7c3bb; font-size: 14px; line-height: 1.7; }
            html body #itemDetailPage:not(.deepstream-person-page) .overview { margin-top: 0; line-height: 1.7; }
            html body #itemDetailPage:not(.deepstream-person-page) .tagline { margin-top: 0; color: #e4dfd6; font-size: 17px; font-weight: 550; }
            html body #itemDetailPage:not(.deepstream-person-page) .itemDetailsGroup { grid-area: metadata; margin: 16px 0 0; color: #aba69c; font-size: 12px; }
            html body #itemDetailPage:not(.deepstream-person-page) .detailPageSecondaryContainer { margin: 30px 0 0; padding: 28px 0 0 !important; border-top: 1px solid #ffffff12; }
            html body #itemDetailPage:not(.deepstream-person-page) .nameContainer .parentName { font-size: 15px; font-weight: 600; letter-spacing: .2px; margin-bottom: 7px; }
            html body #itemDetailPage:not(.deepstream-person-page) .nameContainer .parentName a { color: #c0bbb2; }
            html body #itemDetailPage:not(.deepstream-person-page) .sectionTitle { font-size: 21px; font-weight: 650; letter-spacing: -.4px; }
            @media(max-width:1100px) { html body #itemDetailPage:not(.deepstream-person-page).deepstream-film-page .detailSection { display: block; } html body #itemDetailPage:not(.deepstream-person-page) .detailSectionContent { margin-top: 26px; } }
            @media(max-width:700px) { html body #itemDetailPage:not(.deepstream-person-page) .detailRibbon { min-height: 260px; padding-top: 90px !important; } html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-route-grid { grid-template-columns: 1fr; } html body #itemDetailPage:not(.deepstream-person-page) .trackSelections:not(.hide),html body #itemDetailPage:not(.deepstream-person-page) .deepstream-audio-details { padding: 18px; } }

            .deepstream-technical-column { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
            .deepstream-description-column { min-width: 0; }
            .deepstream-media-details .deepstream-audio-heading { display: flex; align-items: center; }
            .deepstream-media-details .deepstream-audio-heading h3 { margin: 0; }
            .deepstream-media-details .deepstream-audio-grid { display: grid; margin-bottom: 0; }
            .deepstream-media-details .deepstream-audio-grid dd { margin: 0; overflow-wrap: anywhere; }
            .deepstream-media-details .deepstream-audio-route { margin-top: 20px; }
            .deepstream-decoder-info p { color: #bcb6ab; }
            @media(max-width:1100px) { .deepstream-description-column { margin-top: 24px; } }

            /* libmpv is below WebEngine. Playback must leave a transparent hole. */
            html:has(.videoPlayerContainer), html:has(.videoPlayerContainer) body,
            html:has(.videoPlayerContainer) #reactRoot,
            html:has(.videoPlayerContainer) .backgroundContainer { background: transparent !important; }
            html:has(.videoPlayerContainer) .videoPlayerContainer { background-color: transparent !important; }
            html:has(.videoPlayerContainer) #itemDetailPage,
            html:has(.videoPlayerContainer) #indexPage,
            html:has(.videoPlayerContainer) .deepstream-film-art,
            html:has(.videoPlayerContainer) .deepstream-secondary-art { visibility: hidden !important; }
            .MuiButton-containedPrimary, .raised.button-submit, .countIndicator, .unplayedItemCount {
                background: #dfb774 !important; color: #171109 !important;
            }

            /* The same visual language across the library, home and favourites. */
            /* Jellyfin also uses libraryPage for native playback. Its transparentDocument
               state must reveal libmpv beneath WebEngine, including its OSD. */
            html:not(.transparentDocument) body #indexPage,
            html:not(.transparentDocument) body .homePage,
            html:not(.transparentDocument) body .libraryPage { background-color: #090909; color: #eeeae3; }
            html body #indexPage .sections { max-width: 1380px; margin: 0 auto; padding-top: 20px; padding-bottom: 40px; }
            html body .homePage .verticalSection { margin-bottom: 34px; }
            html body .homePage .sectionTitle, html body .libraryPage .sectionTitle { color: #eeeae3; font-size: 23px; line-height: 1.25; font-weight: 650; letter-spacing: -.55px; }
            html body .homePage .sectionTitleContainer { margin-bottom: 14px; }
            html body .homePage .sectionTitleTextButton, html body .libraryPage .sectionTitleTextButton { color: #eeeae3; }
            html body .homePage .sectionTitleTextButton:hover, html body .libraryPage .sectionTitleTextButton:hover { color: #ecc68d; }
            html body .cardImageContainer, html body .cardOverlayContainer, html body .visualCardBox { border-radius: 12px; }
            html body .cardImageContainer { background-color: #1c1b19; box-shadow: inset 0 0 0 1px #ffffff0c, 0 8px 22px #0003; }
            html body .cardOverlayContainer { overflow: hidden; background: rgba(0, 0, 0, .28) !important; }
            html body .cardOverlayContainer > .cardImageContainer { background-color: transparent; box-shadow: none; }
            html body .cardText { color: #dcd8d1; line-height: 1.45; font-size: 14px; }
            html body .cardText-first { font-weight: 550; }
            html body .cardText-secondary { color: #918e88; opacity: 1; font-size: 12px; }
            html body .homePage .cardText { text-align: left; padding-left: 2px; }
            html body .defaultCardBackground { background: radial-gradient(ellipse at 30% 0%,#463625,#201d18 75%) !important; color: #dab780 !important; }
            html body .defaultCardBackground .cardImageIcon { color: #d6b47d; opacity: .85; }
            html body .itemProgressBar { height: 3px; border-radius: 0 0 12px 12px; background: #ffffff14; overflow: hidden; }
            html body .itemProgressBarForeground { background: #dabb87 !important; }
            html body .cardFooter { background: transparent; }
            html body .libraryPage .emby-tabs { color: #a5a097; }
            html body .libraryPage .emby-tab-button-active { color: #e8bf80 !important; }
            html body .libraryPage .paper-icon-button-light:hover, html body .libraryPage .button-flat:hover { color: #ecc68d; }
            html body .MuiButton-root:focus-visible, html body .card:focus-visible { outline: 2px solid #e8bf80; outline-offset: 4px; }
            @media (max-width: 700px) {
                html body #indexPage .sections { padding-top: 12px; }
                html body .homePage .sectionTitle, html body .libraryPage .sectionTitle { font-size: 21px; }
            }

        `;
        document.head.appendChild(style);
        return true;
    }
    function start() {
        applyTheme();
        const logoUrl = win.jmpInfo?.brandImages?.app || '';
        const refresh = () => {
            applyHeaderBranding(document, logoUrl);
            for (const image of document.querySelectorAll('.deepstream-credit img, .company-credit img')) {
                if (win.jmpInfo?.brandImages?.company && image.getAttribute('src') !== win.jmpInfo.brandImages.company) image.setAttribute('src', win.jmpInfo.brandImages.company);
            }
            const connectLogo = document.querySelector('img.logo');
            if (connectLogo && logoUrl && connectLogo.getAttribute('src') !== logoUrl) connectLogo.setAttribute('src', logoUrl);
        };
        refresh();
        new win.MutationObserver(records => {
            if (records.some(record => (record.target.closest?.('.skinHeader, .MuiToolbar-root') || record.target.parentElement?.closest('.MuiToolbar-root')) ||
                Array.from(record.addedNodes || []).some(node => node.matches?.('.skinHeader, .MuiToolbar-root') || node.querySelector?.('.skinHeader, .MuiToolbar-root')))) refresh();
        }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class'], characterData: true});
    }
    // DocumentCreation: insert styling as soon as <head> exists, before server content paints.
    if (!applyTheme()) {
        const early = new win.MutationObserver(() => {if (applyTheme()) early.disconnect();});
        early.observe(document, {childList: true, subtree: true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
    }
    return Object.freeze({install, applyHeaderBranding});
});
