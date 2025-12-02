// js/bagel-select.js


(function () {
  function initSelect(root) {
    const btn  = root.querySelector('.bagel-trigger');
    const list = root.querySelector('.bagel-list');
    const lab  = root.querySelector('.bagel-trigger__label');
    const nat  = root.querySelector('.bagel-native');
    let options = Array.from(list.querySelectorAll('[role="option"]'));

    function open(){ root.setAttribute('aria-open','true'); btn.setAttribute('aria-expanded','true'); list.focus(); setActive(currentIndex()); }
    function close(){ root.removeAttribute('aria-open'); btn.setAttribute('aria-expanded','false'); btn.focus(); }
    const isOpen = () => root.hasAttribute('aria-open');

    function currentIndex(){
      const hot = options.findIndex(o => o.getAttribute('aria-current') === 'true');
      if (hot >= 0) return hot;
      const v = nat.value;
      return Math.max(0, options.findIndex(o => o.dataset.value === v));
    }
    function setActive(i){
      options.forEach(o => o.removeAttribute('aria-current'));
      const opt = options[i];
      if (opt){ opt.setAttribute('aria-current','true'); list.setAttribute('aria-activedescendant', opt.id); opt.scrollIntoView({block:'nearest'}); }
    }
    function setValue(v, fireChange=true){
      const idx = options.findIndex(o => o.dataset.value === v);
      options.forEach(o => o.setAttribute('aria-selected', String(o.dataset.value===v)));
      if (idx>=0){
        const text = options[idx].textContent;
        lab.textContent = text;
        nat.value = v;
        setActive(idx);
        if (fireChange) nat.dispatchEvent(new Event('change', {bubbles:true}));
      }
    }

    // Build from native <option>s if UL is empty (for dynamic lists)
    function rebuildFromNative(){
      if (!nat) return;
      if (!list.children.length && nat.options.length){
        list.innerHTML = '';
        [...nat.options].forEach((o, i) => {
          const li = document.createElement('li');
          li.setAttribute('role','option');
          li.id = `${nat.id || 'opt'}-${i}`;
          li.dataset.value = o.value;
          li.textContent = o.textContent || o.value;
          if (o.selected) li.setAttribute('aria-selected','true');
          list.appendChild(li);
        });
        options = Array.from(list.querySelectorAll('[role="option"]'));
      }
      const sel = nat.value || (nat.querySelector('option[selected]')?.value) || options[0]?.dataset.value || '';
      setValue(sel, false);
    }

    btn.addEventListener('click', () => isOpen() ? close() : open());
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[role="option"]'); if (!li) return;
      setValue(li.dataset.value); close();
    });
    list.addEventListener('keydown', (e)=>{
      let i = currentIndex();
      if (e.key === 'ArrowDown'){ e.preventDefault(); i = Math.min(options.length-1, i+1); setActive(i); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); i = Math.max(0, i-1); setActive(i); }
      else if (e.key === 'Home'){ e.preventDefault(); i = 0; setActive(i); }
      else if (e.key === 'End'){ e.preventDefault(); i = options.length-1; setActive(i); }
      else if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); const opt = options[i]; setValue(opt.dataset.value); close(); }
      else if (e.key === 'Escape'){ e.preventDefault(); close(); }
    });
    document.addEventListener('click', (e)=>{ if (!root.contains(e.target) && isOpen()) close(); });
    nat.addEventListener('change', ()=> setValue(nat.value, false));

    const mo = new MutationObserver(rebuildFromNative);
    mo.observe(nat, { childList: true, attributes: true, subtree: true });

    rebuildFromNative();
  }

  window.addEventListener('load', () => {
    document.querySelectorAll('.bagel-select').forEach(initSelect);
  });
})();
