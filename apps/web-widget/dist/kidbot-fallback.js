(function(){
  const qs = (s, r=document)=>r.querySelector(s);
  const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));

  const fixtures = {
    voice: loadJson('/fixtures/voice/moon.json', {
      persona: 'robot',
      text: '🤖 Beep! The Moon is Earth\'s rocky neighbor. Its craters were made by space rocks. It looks bright because it reflects sunlight!'
    }),
    comics: loadJson('/fixtures/comics/dragon4.json', [
      {title:'Quiet Cave', caption:'Dara the dragon peeks out, small and shy.'},
      {title:'A Small Hello', caption:'A tiny fox waves its tail.'},
      {title:'Sharing Snacks', caption:'Blueberries make everyone smile.'},
      {title:'New Friends', caption:'Warm hugs. Big brave grin.'}
    ]),
    coloring: loadText('/fixtures/coloring/space-cat.svg', fallbackSVG('space cat')),
    science: loadJson('/fixtures/science/buoyancy.json', {
      title: 'Float or Sink?',
      objective: 'Explore why some things float.',
      materials: ['Bowl of water','Orange','Spoon','Paper clip'],
      steps: ['Fill the bowl','Guess float/sink','Place each item','Observe'],
      prediction: { question:'What happens to the orange?', choices:['Floats with peel','Sinks with peel','Spins like a top'], answerIndex:0 },
      explanation: 'The peel traps tiny air pockets, helping it float.',
      supervision: 'Ask an adult to help with water spills.'
    })
  };

  function loadJson(path, fallback){
    return fetch(path, { cache: 'no-store' })
      .then((res)=>res.ok ? res.json() : fallback)
      .catch(()=>fallback);
  }

  function loadText(path, fallback){
    return fetch(path, { cache: 'no-store' })
      .then((res)=>res.ok ? res.text() : fallback)
      .catch(()=>fallback);
  }

  function fallbackSVG(){
    return `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#000" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="512" cy="512" r="400"/>
    <path d="M380 450 q132 -180 264 0" />
    <circle cx="440" cy="500" r="30"/><circle cx="584" cy="500" r="30"/>
    <path d="M512 540 q40 30 80 0" />
    <path d="M420 420 l-40 -80 l80 40 z" />
    <path d="M604 420 l40 -80 l-80 40 z" />
    <path d="M360 640 q152 120 304 0" />
    <circle cx="780" cy="360" r="36"/><circle cx="820" cy="320" r="18"/>
  </g>
</svg>`;
  }

  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

  qsa('.kb-tab').forEach(b=>{
    b.addEventListener('click', ()=>{
      if (b.id === 'kb-fullscreen') {
        if (window.openai?.requestDisplayMode) window.openai.requestDisplayMode({ mode: 'fullscreen' });
        return;
      }
      qsa('.kb-tab').forEach(x=>x.classList.remove('kb-tab--active'));
      b.classList.add('kb-tab--active');
      const tab = b.getAttribute('data-tab');
      qsa('.kb-panel').forEach(p=>p.classList.remove('kb-panel--active'));
      const activePanel = qs('#kb-'+tab);
      if (activePanel) activePanel.classList.add('kb-panel--active');
      window.openai?.setWidgetState?.({ activeTab: tab });
    });
  });

  const personaEl = qs('#kb-persona');
  const voiceIn = qs('#kb-voice-input');
  const voiceOut = qs('#kb-voice-out');
  qs('#kb-voice-send').addEventListener('click', async ()=>{
    const payload = { persona: personaEl.value, text: voiceIn.value || 'Tell me a fun moon fact!', ageBand: '7-9' };
    if (window.openai?.callTool) {
      await window.openai.callTool('voice_chat', payload);
    }
    const fallback = await fallbackVoice(payload);
    voiceOut.textContent = fallback.text;
  });
  qs('#kb-voice-speak').addEventListener('click', ()=>{
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(voiceOut.textContent || 'Hello!');
    speechSynthesis.speak(u);
  });

  async function fallbackVoice({persona, text}) {
    const base = await fixtures.voice;
    const moonMatch = (text || '').toLowerCase().includes('moon');
    const msg = moonMatch ? base.text : 'Hi friend! I can answer with a happy, simple voice. Ask me about space, animals, or stories!';
    const flair = persona==='fairy' ? '✨ ' : persona==='explorer' ? '🧭 ' : '🤖 ';
    return { text: flair + msg.replace(/^([🤖✨🧭]\s)?/, '') };
  }

  qs('#kb-comic-generate').addEventListener('click', async ()=>{
    const theme = qs('#kb-comic-theme').value || 'A shy dragon makes a friend';
    const panels = clamp(parseInt(qs('#kb-comic-count').value||'4', 10),2,6);
    const grid = qs('#kb-comic-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (window.openai?.callTool) {
      await window.openai.callTool('story_panels', { theme, panels, ageBand: '7-9' });
    }
    const data = await fallbackPanels(panels);
    data.forEach(p=>{
      const card = document.createElement('div'); card.className='kb-card';
      card.innerHTML = `<div><strong>${p.title}</strong></div><div>${p.caption}</div>`;
      grid.appendChild(card);
    });
  });

  async function fallbackPanels(count){
    const base = await fixtures.comics;
    return base.slice(0, count);
  }

  const canvas = qs('#kb-color-canvas');
  const ctx = canvas?.getContext ? canvas.getContext('2d') : null;
  const brushEl = qs('#kb-brush');
  const sizeEl = qs('#kb-size');
  let painting=false, strokes=[], current=[];

  function drawLine(p1,p2,color,size){
    if (!ctx) return;
    ctx.strokeStyle=color; ctx.lineWidth=size; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
  }

  function pos(e){
    if (!canvas) return {x:0,y:0};
    const r = canvas.getBoundingClientRect();
    const x = (e.touches? e.touches[0].clientX: e.clientX) - r.left;
    const y = (e.touches? e.touches[0].clientY: e.clientY) - r.top;
    const sx = x * (canvas.width / r.width);
    const sy = y * (canvas.height / r.height);
    return {x:sx,y:sy};
  }

  function bindPaintEvents(){
    if (!canvas) return;
    const start = (e)=>{ painting=true; current=[pos(e)]; e.preventDefault(); };
    const move = (e)=>{ if(!painting) return; const p=pos(e); drawLine(current[current.length-1], p, brushEl.value, parseInt(sizeEl.value,10)); current.push(p); };
    const end = ()=>{ if (painting){ strokes.push({points: current.slice(), color: brushEl.value, size: parseInt(sizeEl.value,10)}); current=[]; } painting=false; };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, {passive:false}); canvas.addEventListener('touchmove', move, {passive:false}); canvas.addEventListener('touchend', end);
  }
  bindPaintEvents();

  qs('#kb-color-generate').addEventListener('click', async ()=>{
    const scene = qs('#kb-color-scene').value || 'space cat';
    const style = qs('#kb-color-style').value || 'space';
    if (window.openai?.callTool) {
      await window.openai.callTool('coloring_outline', { scene, style });
    }
    const svgWrap = qs('#kb-color-svg');
    if (svgWrap) {
      svgWrap.innerHTML = await fixtures.coloring;
    }
    if (ctx) {
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    strokes=[]; current=[];
  });

  qs('#kb-undo').addEventListener('click', ()=>{
    if (!ctx) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    strokes.pop();
    strokes.forEach(s=>{
      for(let i=1;i<s.points.length;i++) drawLine(s.points[i-1], s.points[i], s.color, s.size);
    });
  });

  qs('#kb-clear').addEventListener('click', ()=>{
    if (!ctx) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    strokes=[]; current=[];
  });

  qs('#kb-save').addEventListener('click', ()=>{
    if (!canvas) return;
    const a = document.createElement('a'); a.download='kidbot-coloring.png'; a.href=canvas.toDataURL('image/png'); a.click();
  });

  qs('#kb-sci-generate').addEventListener('click', async ()=>{
    const topic = qs('#kb-sci-topic').value; const age = qs('#kb-sci-age').value;
    if (window.openai?.callTool) {
      await window.openai.callTool('science_sim', { topic, ageBand: age });
    }
    const plan = await fixtures.science;
    qs('#kb-sci-out').textContent = JSON.stringify(plan, null, 2);
  });
})();
