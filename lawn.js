/* ============================================================
   The Lawn Club — living grass background (raw WebGL1)
   A fullscreen fragment shader painting blade-level lawn with
   mown stripes, wind gusts sweeping across, and drifting cloud
   shade. No libraries. Falls back to the CSS gradient on any
   failure or when the user prefers reduced motion.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('lawnGL');
  var scenery = document.querySelector('.scenery');
  if (!canvas || !scenery) return;

  var gl = null;
  try {
    var opts = { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  } catch (e) { gl = null; }
  if (!gl) return; // CSS gradient stays

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var RES_SCALE = 0.6; // grass is soft — render small, let CSS upscale

  var VERT =
    'attribute vec2 a_pos;' +
    'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }';

  var FRAG = [
    'precision highp float;',
    'uniform vec2 u_res;',
    'uniform float u_time;',

    'float hash(vec2 p){',
    '  p = fract(p * vec2(123.34, 345.45));',
    '  p += dot(p, p + 34.345);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i);',
    '  float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0));',
    '  float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float s = 0.0, a = 0.5;',
    '  for(int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.02; a *= 0.5; }',
    '  return s;',
    '}',

    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res.xy;',        // 0..1, y up
    '  float aspect = u_res.x / u_res.y;',
    '  vec2 p = vec2(uv.x * aspect, uv.y);',

    // perspective: grass compresses (finer) toward the top / far end
    '  float far = uv.y;',
    '  float persp = mix(1.0, 3.2, far);',

    // wind — two travelling gusts sweeping left to right
    '  float g1 = fbm(vec2(p.x * 0.8 - u_time * 0.05, p.y * 1.2));',
    '  float g2 = fbm(vec2(p.x * 2.2 - u_time * 0.16, p.y * 2.4 + 3.0));',
    '  float wind = g1 * 0.7 + g2 * 0.3;',
    '  float sway = (wind - 0.5) * 0.05;',

    // blade texture — fine vertical strands, two scales for depth
    '  vec2 bp = vec2((p.x + sway) * 165.0 * persp, uv.y * 30.0 * persp);',
    '  float blades = fbm(bp);',
    '  float strand = fbm(vec2((p.x + sway) * 60.0 * persp, uv.y * 8.0 * persp));',
    '  float tone = mix(strand, blades, 0.45);',

    '  vec3 dark = vec3(0.16, 0.36, 0.18);',
    '  vec3 lite = vec3(0.41, 0.63, 0.30);',
    '  vec3 col = mix(dark, lite, tone);',

    // mown stripes — near vertical (~93deg), alternating light/dark bands
    '  float stripe = sin((uv.x * aspect + uv.y * 0.05) * 3.14159 * 9.0);',
    '  stripe = smoothstep(-0.3, 0.3, stripe);',
    '  col *= mix(0.9, 1.07, stripe);',

    // grass flips its lighter underside as each gust passes through
    '  col += (g2 - 0.5) * 0.07;',

    // haze/light lift toward the far end so it blends into the page
    '  col = mix(col * 0.92, col * 1.07 + vec3(0.03, 0.04, 0.02), far);',

    // warm sunlight from the top-left
    '  float sun = smoothstep(1.25, 0.0, distance(uv, vec2(0.2, 1.0)));',
    '  col += vec3(0.16, 0.13, 0.05) * sun;',

    // slow soft cloud shade drifting across the lawn
    '  float cloud = fbm(vec2(uv.x * 1.1 - u_time * 0.012, uv.y * 0.7 + u_time * 0.006));',
    '  float shade = smoothstep(0.55, 0.92, cloud);',
    '  col *= mix(1.0, 0.66, shade);',

    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return; // fallback to CSS

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'u_res');
  var uTime = gl.getUniformLocation(prog, 'u_time');

  // shader initialised — reveal the canvas, retire the CSS clouds
  scenery.classList.add('gl-on');

  function resize() {
    var w = Math.max(1, Math.floor(window.innerWidth * RES_SCALE));
    var h = Math.max(1, Math.floor(window.innerHeight * RES_SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  var start = performance.now();
  var raf = null;

  function render(t) {
    var time = (t - start) / 1000;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(render);
  }

  function drawOnce() {
    resize();
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, 8.0); // a pleasant static gust
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function play() {
    if (raf == null) { start = performance.now(); raf = requestAnimationFrame(render); }
  }
  function pause() {
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
  }

  // pause when the tab is hidden to save the battery
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause();
    else if (!reduce) play();
  });

  // recover from a lost GL context by falling back to CSS
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    pause();
    scenery.classList.remove('gl-on');
  });

  if (reduce) drawOnce();
  else play();
})();
