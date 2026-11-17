/**
 * image.js — Student photo upload with compression
 * =================================================
 * Rule: a photo is NEVER stored as base64 in the Google Sheet.
 * Flow: pick file -> compress on this device (canvas, max 800px,
 * JPEG quality 0.75) -> show before/after size -> upload to ImgBB
 * -> store ONLY the hosted URL (PhotoURL) in the Sheet.
 *
 * If no ImgBB API key is set (Settings), compression + preview still
 * work, but the photo is NOT uploaded — the UI must say so plainly.
 *
 * Public functions (used by admin.js):
 *   compressImage(file, maxSize, quality) -> Promise<{blob,dataUrl,width,height,originalSize,compressedSize}>
 *   uploadImage(file) -> Promise<{url, originalSize, compressedSize, width, height}>
 *   formatSize(bytes) -> "123 KB"
 */
(function (global) {
  'use strict';

  // >>> PASTE YOUR IMGBB API KEY HERE, or set it in Settings (saved locally) <<<
  // Get a free key at https://api.imgbb.com/ — Settings in the admin panel overrides this.
  var IMGBB_API_KEY = '';

  function getKey() {
    try {
      var saved = localStorage.getItem('mm_v1_imgbb_key');
      if (saved) return saved;
    } catch (e) {}
    return IMGBB_API_KEY;
  }
  function setKey(key) {
    try { localStorage.setItem('mm_v1_imgbb_key', (key || '').trim()); } catch (e) {}
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Resize to max 800px on the longest side, JPEG 0.75. Returns blob + preview data URL.
  function compressImage(file, maxSize, quality) {
    maxSize = maxSize || 800;
    quality = (quality === undefined) ? 0.75 : quality;
    return new Promise(function (resolve, reject) {
      if (!file || file.type.indexOf('image/') !== 0) return reject(new Error('Please choose an image file.'));
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, maxSize / Math.max(w, h));
        var nw = Math.max(1, Math.round(w * scale));
        var nh = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        canvas.getContext('2d').drawImage(img, 0, 0, nw, nh);
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('Compression failed.'));
          var reader = new FileReader();
          reader.onload = function () {
            resolve({ blob: blob, dataUrl: reader.result, width: nw, height: nh, originalSize: file.size, compressedSize: blob.size });
          };
          reader.onerror = function () { reject(new Error('Could not read compressed image.')); };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image file.')); };
      img.src = url;
    });
  }

  // Compress, then upload the compressed file to ImgBB. Returns the hosted URL only.
  function uploadImage(file) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('ImgBB API key not set. Go to Settings and paste your ImgBB API key first — the photo was compressed but NOT uploaded.'));
    return compressImage(file).then(function (c) {
      var form = new FormData();
      form.append('key', key);
      form.append('image', c.blob, 'student.jpg');
      return fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.success || !data.data || !data.data.url) throw new Error('ImgBB upload failed.');
          return { url: data.data.url, originalSize: c.originalSize, compressedSize: c.compressedSize, width: c.width, height: c.height };
        });
    });
  }

  global.MMImage = { compressImage: compressImage, uploadImage: uploadImage, formatSize: formatSize, getKey: getKey, setKey: setKey };
})(typeof window !== 'undefined' ? window : globalThis);
