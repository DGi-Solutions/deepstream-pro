(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeepStreamVideoDetails = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value : null;
  }

  function positiveInteger(value) {
    return positiveNumber(value) !== null && Number.isSafeInteger(value) ? value : null;
  }

  function indexNumber(value) {
    if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value : null;
  }

  function plainText(value) {
    if (typeof value !== 'string') return null;
    const result = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80);
    return result || null;
  }

  function decimal(value, locale) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
  }

  function codecName(value) {
    const text = plainText(value);
    if (!text) return null;
    const key = text.toLowerCase().replace(/[\s._-]/g, '');
    const names = {
      hevc: 'HEVC', h265: 'HEVC', hvc1: 'HEVC', hev1: 'HEVC',
      h264: 'H.264', avc: 'H.264', avc1: 'H.264',
      av1: 'AV1', vp9: 'VP9', vp8: 'VP8',
      mpeg2video: 'MPEG-2', mpeg4: 'MPEG-4',
    };
    return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : text;
  }

  function rangeName(stream) {
    const text = plainText(stream.VideoRangeType) || plainText(stream.VideoRange);
    if (!text) return null;
    const key = text.toLowerCase().replace(/[\s._-]/g, '').replace(/\+/g, 'plus');
    const names = {
      sdr: 'SDR',
      hdr10: 'HDR10',
      hlg: 'HLG',
      hdr10plus: 'HDR10+',
      doviwithhdr10: 'Dolby Vision / HDR10',
      doviwithhdr10plus: 'Dolby Vision / HDR10+',
    };
    return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : text;
  }

  function dolbyNumber(value, locale) {
    if (positiveNumber(value) !== null) return decimal(value, locale);
    const text = plainText(value);
    if (text && /^\d+(?:\.\d+)?$/.test(text) && positiveNumber(Number(text)) !== null) {
      return text;
    }
    return null;
  }

  function model(source = {}, selectedIndex, language = 'de') {
    if (!source || typeof source !== 'object' || !Array.isArray(source.MediaStreams)) {
      return null;
    }
    const videos = source.MediaStreams.filter(function (stream) {
      return stream && typeof stream === 'object' && stream.Type === 'Video';
    });
    if (!videos.length) return null;

    function findIndex(value) {
      const wanted = indexNumber(value);
      if (wanted === null) return null;
      return videos.find(function (stream) { return indexNumber(stream.Index) === wanted; }) || null;
    }

    const stream = findIndex(selectedIndex) || findIndex(source.DefaultVideoStreamIndex) || videos[0];
    const locale = typeof language === 'string' && /^en(?:-|$)/i.test(language) ? 'en-US' : 'de-DE';
    const width = positiveInteger(stream.Width);
    const height = positiveInteger(stream.Height);
    const fps = positiveNumber(stream.AverageFrameRate) || positiveNumber(stream.RealFrameRate);
    const bitrate = positiveNumber(stream.BitRate);
    const bitDepth = positiveInteger(stream.BitDepth);
    const rows = [
      { label: 'Codec', value: codecName(stream.Codec) },
      { label: 'Profil', value: plainText(stream.Profile) },
      { label: 'Auflösung', value: width !== null && height !== null ? width + ' × ' + height : null },
      { label: 'Bildrate', value: fps !== null ? decimal(fps, locale) + ' fps' : null },
      { label: 'Bitrate', value: bitrate !== null
        ? decimal(bitrate / (bitrate >= 1000000 ? 1000000 : 1000), locale)
          + (bitrate >= 1000000 ? ' Mbit/s' : ' kbit/s') : null },
      { label: 'Bittiefe', value: bitDepth !== null ? decimal(bitDepth, locale) + ' Bit' : null },
      { label: 'Pixelformat', value: plainText(stream.PixelFormat) },
      { label: 'Dynamikumfang', value: rangeName(stream) },
      { label: 'Farbraum', value: plainText(stream.ColorSpace) },
      { label: 'Transferfunktion', value: plainText(stream.ColorTransfer) },
      { label: 'Primärfarben', value: plainText(stream.ColorPrimaries) },
      { label: 'Seitenverhältnis', value: plainText(stream.AspectRatio) },
    ];
    const profile = dolbyNumber(stream.DvProfile, locale);
    const level = dolbyNumber(stream.DvLevel, locale);
    if (profile !== null) rows.push({ label: 'Dolby-Vision-Profil', value: profile });
    if (level !== null) rows.push({ label: 'Dolby-Vision-Level', value: level });
    return { title: 'Video', rows: rows };
  }

  return { model: model };
});
