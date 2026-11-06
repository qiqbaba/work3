  /* ============================================================
     9. 拖拽 / 选择文件
     ============================================================ */
  function addFiles(fileList) {
    if (state.busy) {
      showToast('任务处理中，不能修改文件列表。', 'warn');
      return;
    }
    const accept = (state.tool && state.tool.accept) || '';
    const incoming = [];
    for (const f of fileList) {
      const tokens = (accept || '*').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const nameLc = f.name.toLowerCase();
      const ok = tokens.some(tok => {
        if (tok === '*') return true;
        if (tok === 'image/*') return /^image\//.test(f.type) || isImageFileName(nameLc);
        if (tok === '.pdf') return /\.pdf$/.test(nameLc);
        if (tok.charAt(0) === '.') return nameLc.endsWith(tok);
        return true;
      });
      if (!ok) {
        reportError(`文件类型不支持：${f.name}`);
        continue;
      }
      incoming.push(f);
    }
    let added = 0;
    if (state.tool && state.tool.single) {
      if (incoming.length > 1) showToast('仅保留第一个文件。', 'warn');
      if (incoming.length) {
        state.files.forEach(f => releasePreview(f));
        state.files = [incoming[0]];
        added = 1;
      }
    } else if (incoming.length) {
      const maxFiles = Number(state.tool && state.tool.maxFiles) || Infinity;
      const available = Math.max(0, maxFiles - state.files.length);
      if (incoming.length > available && Number.isFinite(maxFiles)) {
        showToast(`最多 ${maxFiles} 个文件，多余已忽略。`, 'warn');
      }
      const accepted = incoming.slice(0, available);
      state.files.push(...accepted);
      added = accepted.length;
    }
    if (added) {
      renderFileList();
      clearResults();
    }
  }

  function canOpenFilePicker() {
    if (state.busy) {
      showToast('任务处理中，不能修改文件列表。', 'warn');
      return false;
    }
    if (state.tool && state.tool.single) return true;
    const maxFiles = Number((state.tool && state.tool.maxFiles) || Infinity);
    if (Number.isFinite(maxFiles) && state.files.length >= maxFiles) {
      showToast(`最多 ${maxFiles} 个文件，请先移除。`, 'warn');
      return false;
    }
    return true;
  }

  wsDropzone.addEventListener('click', () => {
    if (canOpenFilePicker()) wsFileInput.click();
  });
  wsDropzone.addEventListener('keydown', e => {
    if (state.busy) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (canOpenFilePicker()) wsFileInput.click();
    }
  });
  ['dragenter', 'dragover'].forEach(n => wsDropzone.addEventListener(n, e => {
    e.preventDefault(); e.stopPropagation();
    wsDropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(n => wsDropzone.addEventListener(n, e => {
    e.preventDefault(); e.stopPropagation();
    wsDropzone.classList.remove('dragover');
  }));
  wsDropzone.addEventListener('drop', e => {
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  wsFileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files.length) addFiles(e.target.files);
    e.target.value = '';
  });

