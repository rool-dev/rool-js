<script lang="ts">
  import { onMount } from 'svelte';
  import type { ReactiveAppChannel } from '@rool-dev/app';

  interface Props {
    channel: ReactiveAppChannel;
  }

  let { channel }: Props = $props();

  const COLS = 20;
  const ROWS = 20;
  const CELL = 20;
  const WIDTH = COLS * CELL;
  const HEIGHT = ROWS * CELL;
  const BASE_SPEED = 220;

  type Point = { x: number; y: number };
  type Dir = 'up' | 'down' | 'left' | 'right';
  const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

  let snake = $state<Point[]>([{ x: 10, y: 10 }]);
  let food = $state<Point>({ x: 15, y: 10 });
  let dir = $state<Dir>('right');
  let nextDir = $state<Dir>('right');
  let running = $state(false);
  let over = $state(false);
  let score = $state(0);
  let personalBest = $state(0);
  let highScores = $state<{ userId: string; score: number }[]>([]);

  let canvas: HTMLCanvasElement;
  let interval: ReturnType<typeof setInterval> | null = null;

  function spawnFood(): Point {
    let pos: Point;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    return pos;
  }

  function start() {
    snake = [{ x: 10, y: 10 }];
    dir = 'right';
    nextDir = 'right';
    food = spawnFood();
    score = 0;
    over = false;
    running = true;
    scheduleLoop();
    draw();
  }

  function scheduleLoop() {
    if (interval) clearInterval(interval);
    interval = setInterval(tick, Math.max(60, BASE_SPEED - score * 3));
  }

  function tick() {
    dir = nextDir;
    const head: Point = { ...snake[0] };

    switch (dir) {
      case 'up': head.y--; break;
      case 'down': head.y++; break;
      case 'left': head.x--; break;
      case 'right': head.x++; break;
    }

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      endGame();
      return;
    }

    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      endGame();
      return;
    }

    snake = [head, ...snake];

    if (head.x === food.x && head.y === food.y) {
      score++;
      food = spawnFood();
      scheduleLoop();
    } else {
      snake = snake.slice(0, -1);
    }

    draw();
  }

  async function endGame() {
    running = false;
    over = true;
    if (interval) { clearInterval(interval); interval = null; }
    draw();
    await saveScore();
  }

  async function saveScore() {
    if (score === 0 || score <= personalBest) return;

    try {
      const userId = channel.userId;
      const { objects } = await channel.findObjects({
        collection: 'highscores',
        where: { userId },
      });

      if (objects.length > 0) {
        await channel.updateObject(objects[0].id, {
          data: { score, date: new Date().toISOString() },
        });
      } else {
        await channel.createObject({
          data: { userId, score, date: new Date().toISOString() },
        });
      }

      personalBest = score;
      await loadHighScores();
    } catch (e) {
      console.error('Failed to save score:', e);
    }
  }

  async function loadHighScores() {
    try {
      const { objects } = await channel.findObjects({ collection: 'highscores' });
      highScores = objects
        .map(o => ({ userId: o.userId as string, score: o.score as number }))
        .filter(h => typeof h.score === 'number')
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      const mine = highScores.find(h => h.userId === channel.userId);
      personalBest = mine?.score ?? 0;
    } catch (e) {
      console.error('Failed to load high scores:', e);
    }
  }

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, HEIGHT);
      ctx.stroke();
    }
    for (let i = 0; i <= ROWS; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(WIDTH, i * CELL);
      ctx.stroke();
    }

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fca5a5';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2 - 2, food.y * CELL + CELL / 2 - 2, 3, 0, Math.PI * 2);
    ctx.fill();

    snake.forEach((seg, i) => {
      const r = i === 0 ? 4 : 3;
      ctx.fillStyle = i === 0 ? '#22c55e' : '#4ade80';
      ctx.beginPath();
      ctx.roundRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2, r);
      ctx.fill();
    });

    if (over) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', WIDTH / 2, HEIGHT / 2 - 12);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(`Score: ${score}`, WIDTH / 2, HEIGHT / 2 + 16);
      if (score > 0 && score >= personalBest) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText('New personal best!', WIDTH / 2, HEIGHT / 2 + 40);
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!running) { start(); e.preventDefault(); }
      return;
    }

    const keyMap: Record<string, Dir> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
    };
    const newDir = keyMap[e.key];
    if (!newDir || !running) return;
    if (OPPOSITE[newDir] !== dir) {
      nextDir = newDir;
      e.preventDefault();
    }
  }

  function steer(newDir: Dir) {
    if (!running) return;
    if (OPPOSITE[newDir] !== dir) nextDir = newDir;
  }

  onMount(() => {
    draw();
    loadHighScores();
    return () => { if (interval) { clearInterval(interval); interval = null; } };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="h-full flex flex-col items-center justify-center gap-4 p-6 bg-slate-950 select-none"
  role="application"
>
  <div class="flex items-center gap-8 text-sm font-mono">
    <span class="text-slate-400">Score <span class="text-white font-bold text-base">{score}</span></span>
    <span class="text-slate-400">Best <span class="text-amber-400 font-bold text-base">{personalBest}</span></span>
  </div>

  <canvas
    bind:this={canvas}
    width={WIDTH}
    height={HEIGHT}
    class="border border-slate-700 rounded-lg touch-none"
  ></canvas>

  {#if running}
    {@const btnClass = "h-11 bg-slate-800 active:bg-slate-600 rounded-lg text-slate-400 text-lg font-bold cursor-pointer select-none touch-manipulation"}
    <div class="grid grid-cols-3 gap-1.5 w-36">
      <div></div>
      <button class={btnClass} onclick={() => steer('up')}>&#9650;</button>
      <div></div>
      <button class={btnClass} onclick={() => steer('left')}>&#9664;</button>
      <div></div>
      <button class={btnClass} onclick={() => steer('right')}>&#9654;</button>
      <div></div>
      <button class={btnClass} onclick={() => steer('down')}>&#9660;</button>
      <div></div>
    </div>
  {/if}

  {#if !running}
    <button
      onclick={start}
      class="px-6 py-2.5 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-semibold rounded-lg transition-colors cursor-pointer"
    >
      {over ? 'Play Again' : 'Start Game'}
    </button>
    <p class="text-slate-600 text-xs">Arrow keys or WASD &middot; Space to start</p>
  {/if}

  {#if highScores.length > 0}
    <div class="mt-2" style="width: {WIDTH}px">
      <h2 class="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Leaderboard</h2>
      <div class="bg-slate-900/80 rounded-lg border border-slate-800 divide-y divide-slate-800/60">
        {#each highScores as entry, i}
          <div class="flex items-center px-3 py-1.5 text-sm font-mono {entry.userId === channel.userId ? 'bg-green-950/30' : ''}">
            <span class="w-7 text-slate-600 text-xs">{i + 1}.</span>
            <span class="flex-1 text-slate-300 truncate">
              {#if entry.userId === channel.userId}
                <span class="text-green-400">You</span>
              {:else}
                {entry.userId.slice(0, 8)}
              {/if}
            </span>
            <span class="text-amber-400 font-bold">{entry.score}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
