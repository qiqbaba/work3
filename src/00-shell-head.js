/**
 * 办公文件工具箱 - 核心框架与工具实现
 * 100% Client-side: PDF.js (渲染) + pdf-lib (PDF 编辑) + JSZip (打包) + Canvas (图片)
 */
(function () {
  'use strict';

  /* 旧版以 pdf2png.* 存储置顶、票据配置等数据；改名后一次性迁移，旧键保留以兼容回退。 */
  (function migrateLegacyKeys() {
    var names = ['pinned', 'recent', 'fileViewMode', 'billConfig', 'billCache.v1', 'installPrompt'];
    try {
      names.forEach(function (name) {
        var oldKey = 'pdf2png.' + name;
        var newKey = 'officetoolbox.' + name;
        if (localStorage.getItem(newKey) === null) {
          var value = localStorage.getItem(oldKey);
          if (value !== null) localStorage.setItem(newKey, value);
        }
      });
    } catch (e) { /* 存储不可用时跳过迁移 */ }
  })();
