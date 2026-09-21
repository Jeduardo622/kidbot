(function () {
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const samples = {
    voice: "The Moon is Earth's rocky neighbor. Its craters were made by space rocks, and it looks bright because it reflects sunlight!",
    comics: [
      { title: 'Quiet Cave', caption: 'Dara the dragon peeks out, small and shy.' },
      { title: 'A Small Hello', caption: 'A tiny fox waves its tail.' },
      { title: 'Sharing Snacks', caption: 'Blueberries make everyone smile.' },
      { title: 'New Friends', caption: 'Warm hugs. Big brave grin.' },
    ],
    coloring: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g stroke="#000" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><circle cx="512" cy="512" r="400"/><path d="M380 450q132-180 264 0"/><circle cx="440" cy="500" r="30"/><circle cx="584" cy="500" r="30"/><path d="M440 590q72 70 144 0M420 420l-40-80 80 40zm184 0 40-80-80 40z"/><circle cx="790" cy="320" r="35"/></g></svg>',
    science: {
      title: 'Float or Sink?',
      objective: 'Explore why some things float.',
      materials: ['Bowl of water', 'Orange', 'Spoon', 'Paper clip'],
      steps: ['Fill the bowl', 'Guess float or sink', 'Place each item', 'Observe'],
      explanation: 'The orange peel traps tiny air pockets, helping it float.',
      supervision: 'Ask an adult to help with water spills.',
    },
  };

  const showDemoError = (error) => {
    const notice = qs('#kb-demo-notice');
    if (!notice) return;
    notice.setAttribute('role', 'alert');
    notice.textContent = `Offline demo error: ${error instanceof Error ? error.message : 'the sample could not be displayed'}`;
  };
  const runDemo = (action) => Promise.resolve().then(action).catch(showDemoError);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  qsa('.kb-tab[data-tab]').forEach((button) => {
    button.addEventListener('click', () => runDemo(() => {
      qsa('.kb-tab[data-tab]').forEach((item) => item.classList.remove('kb-tab--active'));
      button.classList.add('kb-tab--active');
      qsa('.kb-panel').forEach((panel) => panel.classList.remove('kb-panel--active'));
      qs(`#kb-${button.getAttribute('data-tab')}`)?.classList.add('kb-panel--active');
    }));
  });

  qs('#kb-fullscreen')?.addEventListener('click', () => runDemo(async () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
  }));

  qs('#kb-voice-send')?.addEventListener('click', () => runDemo(() => {
    const persona = qs('#kb-persona')?.value;
    const flair = persona === 'fairy' ? '✨' : persona === 'explorer' ? '🧭' : '🤖';
    qs('#kb-voice-out').textContent = `${flair} ${samples.voice}`;
  }));
  qs('#kb-voice-speak')?.addEventListener('click', () => runDemo(() => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    speechSynthesis.speak(new SpeechSynthesisUtterance(qs('#kb-voice-out')?.textContent || samples.voice));
  }));

  qs('#kb-comic-generate')?.addEventListener('click', () => runDemo(() => {
    const count = clamp(Number.parseInt(qs('#kb-comic-count')?.value || '4', 10), 2, 4);
    const grid = qs('#kb-comic-grid');
    grid.replaceChildren(...samples.comics.slice(0, count).map((panel) => {
      const card = document.createElement('article');
      card.className = 'kb-card';
      const title = document.createElement('strong');
      const caption = document.createElement('p');
      title.textContent = panel.title;
      caption.textContent = panel.caption;
      card.append(title, caption);
      return card;
    }));
  }));

  const canvas = qs('#kb-color-canvas');
  const context = canvas?.getContext?.('2d');
  let painting = false;
  let previousPoint;
  const point = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const pointer = event.touches?.[0] || event;
    return { x: (pointer.clientX - bounds.left) * canvas.width / bounds.width, y: (pointer.clientY - bounds.top) * canvas.height / bounds.height };
  };
  const start = (event) => { painting = true; previousPoint = point(event); event.preventDefault(); };
  const move = (event) => {
    if (!painting || !context) return;
    const nextPoint = point(event);
    context.strokeStyle = qs('#kb-brush').value;
    context.lineWidth = Number(qs('#kb-size').value);
    context.beginPath(); context.moveTo(previousPoint.x, previousPoint.y); context.lineTo(nextPoint.x, nextPoint.y); context.stroke();
    previousPoint = nextPoint;
  };
  const end = () => { painting = false; previousPoint = undefined; };
  canvas?.addEventListener('mousedown', start); canvas?.addEventListener('mousemove', move); canvas?.addEventListener('mouseup', end);
  canvas?.addEventListener('touchstart', start, { passive: false }); canvas?.addEventListener('touchmove', move, { passive: false }); canvas?.addEventListener('touchend', end);

  qs('#kb-color-generate')?.addEventListener('click', () => runDemo(() => { qs('#kb-color-svg').innerHTML = samples.coloring; }));
  qs('#kb-undo')?.addEventListener('click', () => runDemo(() => context?.clearRect(0, 0, canvas.width, canvas.height)));
  qs('#kb-clear')?.addEventListener('click', () => runDemo(() => context?.clearRect(0, 0, canvas.width, canvas.height)));
  qs('#kb-save')?.addEventListener('click', () => runDemo(() => {
    const link = document.createElement('a'); link.download = 'kidbot-offline-coloring.png'; link.href = canvas.toDataURL('image/png'); link.click();
  }));

  qs('#kb-sci-generate')?.addEventListener('click', () => runDemo(() => { qs('#kb-sci-out').textContent = JSON.stringify(samples.science, null, 2); }));
})();
