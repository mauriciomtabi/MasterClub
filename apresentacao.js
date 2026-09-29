/*
 * Motor da apresentação. Sem biblioteca: o arquivo abre direto do disco se a internet do
 * evento falhar (só as fontes vêm de fora, e caem para a fonte do sistema).
 *
 * Passador de slides manda PageDown/PageUp; teclado usa setas e espaço.
 * Modo apresentador (tecla P) abre outra janela com anotações, próximo slide e cronômetro;
 * as duas janelas se falam por BroadcastChannel, então qualquer uma pode avançar.
 */
(function () {
  const stage = document.getElementById('stage')
  const slides = Array.from(stage.querySelectorAll('.slide'))
  const total = slides.length
  const apresentador = new URLSearchParams(location.search).has('apresentador')
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('mtabi-palestra') : null

  let atual = 0
  let passo = 0
  let ideRodando = false

  const passos = (i) => slides[i].querySelectorAll('.f').length
  const doisDigitos = (n) => String(n).padStart(2, '0')

  // Grades do método: o mesmo desenho do site, descrito em texto no HTML.
  document.querySelectorAll('.mg[data-d]').forEach((mg) => {
    let k = 0 // ordem de entrada dos blocos cheios, para o salto em sequência
    mg.dataset.d.split(' ').forEach((linha) => {
      ;[...linha].forEach((e, col) => {
        const i = document.createElement('i')
        i.dataset.e = e
        i.style.setProperty('--col', col)
        if (e !== '.') i.style.setProperty('--k', k++)
        mg.appendChild(i)
      })
    })
  })

  // ---------- Som: sintetizado no navegador (sem arquivo), só na janela da plateia ----------
  // O navegador só libera áudio depois de um gesto; o clique/tecla de avançar é esse gesto.
  const som = (() => {
    let ctx = null
    let mestre = null
    let ruido = null
    let mudo = false
    const ativo = () => !apresentador && !mudo && ctx
    function destravar() {
      if (apresentador) return
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        ctx = new AC()
        const n = ctx.sampleRate * 3
        ruido = ctx.createBuffer(1, n, ctx.sampleRate)
        const d = ruido.getChannelData(0)
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
      }
      if (ctx.state === 'suspended') ctx.resume()
      novoMestre()
    }
    function novoMestre() {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 6
      mestre = ctx.createGain()
      mestre.gain.value = 0.9
      mestre.connect(comp).connect(ctx.destination)
    }
    function parar() {
      if (!ctx || !mestre) return
      const velho = mestre
      velho.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
      setTimeout(() => velho.disconnect(), 400)
      novoMestre()
    }
    function fonteRuido() {
      const s = ctx.createBufferSource()
      s.buffer = ruido
      s.loop = true
      return s
    }
    // envelope: lista de [segundos a partir de agora, valor]
    function curva(param, pontos, t0) {
      param.setValueAtTime(pontos[0][1], t0 + pontos[0][0])
      pontos.slice(1).forEach(([t, v]) => param.linearRampToValueAtTime(v, t0 + t))
    }
    function motor(pontosGanho, pontosFiltro, pontosGrave) {
      const t0 = ctx.currentTime
      const fim = pontosGanho[pontosGanho.length - 1][0]
      const n = fonteRuido()
      const filtro = ctx.createBiquadFilter()
      filtro.type = 'lowpass'
      filtro.Q.value = 0.8
      const g = ctx.createGain()
      curva(filtro.frequency, pontosFiltro, t0)
      curva(g.gain, pontosGanho, t0)
      n.connect(filtro).connect(g).connect(mestre)
      n.start(t0)
      n.stop(t0 + fim + 0.1)
      // ronco grave por baixo do chiado
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      const fo = ctx.createBiquadFilter()
      fo.type = 'lowpass'
      fo.frequency.value = 140
      const go = ctx.createGain()
      curva(o.frequency, pontosGrave, t0)
      curva(go.gain, pontosGanho.map(([t, v]) => [t, v * 0.55]), t0)
      o.connect(fo).connect(go).connect(mestre)
      o.start(t0)
      o.stop(t0 + fim + 0.1)
    }
    function baque(forca, t = 0) {
      const t0 = ctx.currentTime + t
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(140, t0)
      o.frequency.exponentialRampToValueAtTime(32, t0 + 0.9 * forca)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(1.1 * forca, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1 * forca)
      o.connect(g).connect(mestre)
      o.start(t0)
      o.stop(t0 + 1.3 * forca)
      const n = fonteRuido()
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(2600, t0)
      f.frequency.exponentialRampToValueAtTime(160, t0 + 1.4 * forca)
      const gn = ctx.createGain()
      gn.gain.setValueAtTime(0.0001, t0)
      gn.gain.exponentialRampToValueAtTime(0.9 * forca, t0 + 0.01)
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6 * forca)
      n.connect(f).connect(gn).connect(mestre)
      n.start(t0)
      n.stop(t0 + 1.8 * forca)
    }
    return {
      destravar,
      parar,
      alternarMudo() { mudo = !mudo; if (mudo) parar(); return mudo },
      bip(freq = 660, dur = 0.22) {
        if (!ativo()) return
        const t0 = ctx.currentTime
        const o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.value = freq
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        o.connect(g).connect(mestre)
        o.start(t0)
        o.stop(t0 + dur + 0.05)
      },
      // ignição 1,3 s + subida 1,7 s, igual à animação
      decolagem() {
        if (!ativo()) return
        motor(
          [[0, 0.0001], [0.15, 0.25], [1.3, 0.55], [2.2, 0.7], [3.0, 0.35], [4.4, 0.0001]],
          [[0, 250], [1.3, 700], [2.4, 1900], [4.4, 500]],
          [[0, 38], [1.3, 48], [3.0, 62], [4.4, 50]],
        )
        baque(0.6, 1.3)
      },
      // descida de 1,9 s: chega forte e corta no toque, com baque
      pouso() {
        if (!ativo()) return
        motor(
          [[0, 0.0001], [0.3, 0.25], [1.6, 0.65], [1.9, 0.6], [2.05, 0.0001]],
          [[0, 1800], [1.9, 450], [2.05, 300]],
          [[0, 60], [1.9, 40], [2.05, 36]],
        )
        baque(0.7, 1.9)
      },
      explosao() {
        if (!ativo()) return
        baque(1.4)
        baque(0.5, 0.12)
      },
    }
  })()

  // Qualquer clique ou tecla na janela da plateia já libera o áudio, para o caso de a
  // contagem ser disparada pela janela do apresentador (que não gera gesto aqui).
  ;['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => som.destravar(), { once: true }))

  // ---------- Capa: 25 blocos que se desmontam e montam as formas da palestra ----------
  // '1' âmbar, '2' creme, '.' vazio. Entender a Medir são os desenhos do método no site.
  const FORMAS = [
    { nome: 'MTABI', d: '1...1 1..11 11..1 1.111 111.1' },
    { nome: '01 · Entender', d: '2.2.1 .22.2 1.2.. .2.21 22.2.' },
    { nome: '02 · Simplificar', d: '..2.. ....2 2.... ....2 .2...' },
    { nome: '03 · Conectar', d: '2...2 .2.2. ..1.. .2.2. 2...2' },
    { nome: '04 · Automatizar', d: '..1.. ...1. 11111 ...1. ..1..' },
    { nome: '05 · Medir', d: '....1 ...21 .2.21 22221 22221' },
    { nome: 'Master Club', d: '..1.. .121. .121. 11111 1.1.1' },
  ]
  const PASSO = 124 // 108 de bloco + 16 de vão, igual ao CSS
  const capaM = document.querySelector('.capa__m')
  const capa = {
    pecas: [],
    forma: 0,
    timers: [],
    rodando: false,
    legenda: capaM && capaM.querySelector('.capa__legenda'),
  }
  if (capaM) {
    for (let k = 0; k < 25; k++) capaM.insertBefore(Object.assign(document.createElement('i'), { className: 'fantasma' }), capaM.firstChild)
    const camada = capaM.querySelector('.capa__pecas')
    for (let k = 0; k < 25; k++) {
      const b = document.createElement('b')
      camada.appendChild(b)
      capa.pecas.push(b)
    }
  }
  const sorteio = (a, b) => a + Math.random() * (b - a)
  const embaralhar = (arr) => arr.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1])

  function espalhar(peca, atraso) {
    peca.style.transitionDelay = `${atraso}ms`
    peca.style.transform = `translate(${sorteio(-1150, 350)}px, ${sorteio(-320, 760)}px) rotate(${sorteio(-160, 160)}deg) scale(0.55)`
    peca.style.opacity = '0'
  }
  // Monta um desenho 5×5. Peça que não entra no desenho sai voando (espalhar).
  function montarDesenho(d, atrasoPorPeca) {
    const alvos = []
    d.split(' ').forEach((linha, l) => {
      ;[...linha].forEach((e, c) => { if (e !== '.') alvos.push({ l, c, e }) })
    })
    const pecas = embaralhar(capa.pecas)
    pecas.forEach((p, k) => {
      const alvo = alvos[k]
      if (!alvo) {
        if (p.style.opacity === '1') espalhar(p, 0)
        return
      }
      p.dataset.e = alvo.e
      p.style.transitionDelay = `${k * atrasoPorPeca}ms`
      p.style.transform = `translate(${alvo.c * PASSO}px, ${alvo.l * PASSO}px)`
      p.style.opacity = '1'
    })
  }
  function montar(indice) {
    montarDesenho(FORMAS[indice].d, 55)
    if (capa.legenda) {
      capa.legenda.classList.remove('on')
      capa.timers.push(setTimeout(() => {
        capa.legenda.textContent = FORMAS[indice].nome
        capa.legenda.classList.add('on')
      }, 500))
    }
  }
  // ---------- Decolagem do foguete (última forma do ciclo) ----------
  const fxCamada = capaM && capaM.insertBefore(Object.assign(document.createElement('div'), { className: 'capa__fx' }), capaM.querySelector('.capa__pecas'))
  const camadaPecas = capaM && capaM.querySelector('.capa__pecas')
  const slideCapa = capaM && capaM.closest('.slide')
  const BICO_X = 2 * PASSO + 54 // centro da coluna do meio
  const BASE_Y = 5 * PASSO - 16 // logo abaixo da última linha

  function particula(tipo, x, y, dx, dy, tamanho, duracao) {
    const el = document.createElement('i')
    el.className = tipo
    el.style.cssText = `left:${x}px;top:${y}px;width:${tamanho}px;height:${tamanho}px`
    fxCamada.appendChild(el)
    const inicio = tipo === 'fumaca' ? 0.35 : 1
    const fim = tipo === 'fumaca' ? sorteio(2.2, 3.4) : sorteio(0.1, 0.35)
    el.animate(
      [
        { transform: `translate(-50%, -50%) scale(${inicio})`, opacity: tipo === 'fumaca' ? 0.85 : 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${fim})`, opacity: 0 },
      ],
      { duration: duracao, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    ).onfinish = () => el.remove()
  }

  function decolar(depois) {
    const IGNICAO = 1300
    const SUBIDA = 1700
    const t0 = performance.now()
    function quadro(agora) {
      if (!capa.rodando) return
      const t = agora - t0
      let subiu = 0
      let tremor = 0
      if (t < IGNICAO) {
        tremor = 2 + (t / IGNICAO) * 6
      } else {
        const p = Math.min(1, (t - IGNICAO) / SUBIDA)
        subiu = 1600 * p * p * p // acelera como foguete de verdade
        tremor = 5 * (1 - p)
      }
      const jx = sorteio(-tremor, tremor)
      const jy = sorteio(-tremor, tremor)
      camadaPecas.style.transform = `translate(${jx}px, ${jy - subiu}px)`
      slideCapa.style.transform = t < IGNICAO + 600 ? `translate(${jx * 0.35}px, ${jy * 0.35}px)` : ''

      const bocal = BASE_Y - subiu
      if (bocal > -200) {
        // fogo: sai do bocal para baixo, abrindo em leque
        const n = t < IGNICAO ? 3 : 6
        for (let k = 0; k < n; k++) {
          particula('fogo', BICO_X + sorteio(-70, 70), bocal, sorteio(-90, 90), sorteio(160, t < IGNICAO ? 320 : 520), sorteio(50, 110), sorteio(350, 650))
        }
        // fumaça: no chão se espalha para os lados; no ar, fica como rastro
        if (Math.random() < (t < IGNICAO ? 0.9 : 0.6)) {
          const noChao = t < IGNICAO + 400
          particula(
            'fumaca',
            BICO_X + sorteio(-60, 60),
            noChao ? BASE_Y + 60 : bocal + 80,
            noChao ? sorteio(-750, 750) : sorteio(-160, 160),
            noChao ? sorteio(-160, 40) : sorteio(40, 200),
            sorteio(140, 240),
            sorteio(2200, 3400),
          )
        }
      }
      if (t < IGNICAO + SUBIDA + 200) {
        capa.raf = requestAnimationFrame(quadro)
      } else {
        // foguete fora da tela: some sem voar de volta, e a fumaça assenta
        capaM.classList.add('sem-transicao')
        capa.pecas.forEach((p) => espalhar(p, 0))
        camadaPecas.style.transform = ''
        slideCapa.style.transform = ''
        void capaM.offsetWidth
        capaM.classList.remove('sem-transicao')
        depois()
      }
    }
    if (capa.legenda) capa.legenda.classList.remove('on')
    capa.raf = requestAnimationFrame(quadro)
  }

  function cicloCapa() {
    if (!capa.rodando) return
    montar(capa.forma)
    if (FORMAS[capa.forma].nome === 'Master Club') {
      capa.timers.push(setTimeout(() => {
        if (capa.comSom) som.decolagem()
        capa.comSom = false
      }, 3000))
      capa.timers.push(setTimeout(() => decolar(() => {
        // a fumaça assenta antes de o M voltar
        capa.timers.push(setTimeout(() => {
          capa.forma = 0
          cicloCapa()
        }, 1600))
      }), 3000))
      return
    }
    capa.timers.push(setTimeout(() => {
      capa.pecas.forEach((p) => espalhar(p, Math.random() * 180))
      if (capa.legenda) capa.legenda.classList.remove('on')
      capa.forma = (capa.forma + 1) % FORMAS.length
      capa.timers.push(setTimeout(cicloCapa, 750))
    }, 4600))
  }
  function iniciarCapa() {
    if (!capaM || capa.rodando) return
    capa.rodando = true
    capa.forma = 0
    capaM.classList.add('sem-transicao')
    capa.pecas.forEach((p) => espalhar(p, 0))
    void capaM.offsetWidth
    capaM.classList.remove('sem-transicao')
    capa.timers.push(setTimeout(cicloCapa, 80))
  }
  function pararCapa() {
    capa.rodando = false
    capa.timers.forEach(clearTimeout)
    capa.timers = []
    if (capa.raf) cancelAnimationFrame(capa.raf)
    if (camadaPecas) camadaPecas.style.transform = ''
    if (slideCapa) slideCapa.style.transform = ''
    if (fxCamada) fxCamada.innerHTML = ''
    capa.transicao = false
    if (slideCapa) slideCapa.classList.remove('contagem')
    if (capaM) capaM.classList.remove('rapido')
  }

  // ---------- Saída da capa: tudo some, blocos no centro, 3·2·1, foguete leva ao slide 2 ----------
  const DIGITOS = [
    '1111. ....1 .111. ....1 1111.',
    '.111. 1...1 ..11. .1... 11111',
    '..1.. .11.. ..1.. ..1.. .111.',
  ]
  function contagemRegressiva() {
    if (!capaM) return mostrar(1, 0, false)
    capa.timers.forEach(clearTimeout)
    capa.timers = []
    if (capa.raf) cancelAnimationFrame(capa.raf)
    fxCamada.innerHTML = ''
    camadaPecas.style.transform = ''
    capa.rodando = true
    capa.transicao = true
    slideCapa.classList.add('contagem')
    capaM.classList.add('rapido')
    const agenda = (ms, fn) => capa.timers.push(setTimeout(() => capa.transicao && fn(), ms))
    agenda(700, () => { montarDesenho(DIGITOS[0], 12); som.bip(660) })
    agenda(1700, () => { montarDesenho(DIGITOS[1], 12); som.bip(660) })
    agenda(2700, () => { montarDesenho(DIGITOS[2], 12); som.bip(660) })
    agenda(3700, () => {
      capaM.classList.remove('rapido')
      som.bip(1320, 0.5)
      montarDesenho(FORMAS.find((f) => f.nome === 'Master Club').d, 30)
    })
    agenda(5000, () => som.decolagem())
    agenda(5000, () => decolar(() => {
      if (capa.transicao) iniciarPouso()
    }))
  }

  // ---------- Chegada no slide 2: o foguete pousa, vira o M e explode revelando o conteúdo ----------
  // O mesmo conjunto de blocos é emprestado ao slide 2 durante a chegada e devolvido à capa no fim.
  const FOGUETE = FORMAS.find((f) => f.nome === 'Master Club').d
  function devolverBlocos() {
    if (!capaM || !slideCapa) return
    capaM.classList.remove('visitante')
    slideCapa.insertBefore(capaM, slideCapa.querySelector('.capa__faixa'))
    capa.pecas.forEach((p) => { p.style.transition = '' })
  }
  function terminarPouso() {
    if (!capa.pouso) return
    capa.pouso = false
    capa.rodando = false
    capa.timers.forEach(clearTimeout)
    capa.timers = []
    if (capa.raf) cancelAnimationFrame(capa.raf)
    fxCamada.innerHTML = ''
    camadaPecas.style.transform = ''
    slides[1].style.transform = ''
    slides[1].classList.remove('pousando')
    devolverBlocos()
  }
  function onda(x, y) {
    const el = document.createElement('i')
    el.className = 'onda'
    el.style.cssText = `left:${x}px;top:${y}px;width:220px;height:220px`
    fxCamada.appendChild(el)
    el.animate(
      [{ transform: 'translate(-50%, -50%) scale(0.2)', opacity: 1 }, { transform: 'translate(-50%, -50%) scale(9)', opacity: 0 }],
      { duration: 1100, easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)', fill: 'forwards' },
    ).onfinish = () => el.remove()
  }
  function iniciarPouso() {
    const destino = slides[1]
    // Esconde o conteúdo ANTES de o slide aparecer e sem transição; senão ele surge e vai apagando.
    destino.classList.add('instantaneo', 'pousando')
    void destino.offsetWidth
    destino.classList.remove('instantaneo')
    mostrar(1, 0, false) // derruba o ciclo da capa; a partir daqui o slide 2 é o palco
    destino.classList.add('pousando') // mostrar() pode ter limpado a classe
    capa.rodando = true
    capa.pouso = true
    destino.appendChild(capaM)
    capaM.classList.add('visitante')

    // foguete montado de uma vez, fora da tela, lá em cima
    capaM.classList.add('sem-transicao')
    camadaPecas.style.transform = 'translateY(-1500px)'
    montarDesenho(FOGUETE, 0)
    void capaM.offsetWidth
    capaM.classList.remove('sem-transicao')

    som.pouso()
    const DESCIDA = 1900
    const t0 = performance.now()
    function quadro(agora) {
      if (!capa.pouso) return
      const p = Math.min(1, (agora - t0) / DESCIDA)
      const alto = 1500 * Math.pow(1 - p, 3) // chega rápido e freia no fim
      const tremor = 2 + 4 * p
      camadaPecas.style.transform = `translate(${sorteio(-tremor, tremor)}px, ${-alto}px)`
      const bocal = BASE_Y - alto
      // retrofoguete: fogo para baixo, mais forte perto do chão
      for (let k = 0; k < 3 + Math.round(p * 4); k++) {
        particula('fogo', BICO_X + sorteio(-60, 60), bocal, sorteio(-70, 70), sorteio(140, 300), sorteio(45, 100), sorteio(300, 550))
      }
      if (alto < 420 && Math.random() < 0.8) {
        particula('fumaca', BICO_X + sorteio(-60, 60), BASE_Y + 60, sorteio(-800, 800), sorteio(-140, 30), sorteio(150, 250), sorteio(2000, 3000))
      }
      if (p < 1) {
        capa.raf = requestAnimationFrame(quadro)
        return
      }
      // toque no chão
      camadaPecas.style.transform = ''
      for (let k = 0; k < 18; k++) {
        particula('fumaca', BICO_X + sorteio(-80, 80), BASE_Y + 50, sorteio(-900, 900), sorteio(-220, 20), sorteio(180, 280), sorteio(2200, 3200))
      }
      const t1 = performance.now()
      ;(function tranco(agora) {
        if (!capa.pouso) return
        const q = (agora - t1) / 350
        destino.style.transform = q < 1 ? `translate(${sorteio(-6, 6) * (1 - q)}px, ${sorteio(-6, 6) * (1 - q)}px)` : ''
        if (q < 1) capa.raf = requestAnimationFrame(tranco)
      })(t1)

      const agenda = (ms, fn) => capa.timers.push(setTimeout(() => capa.pouso && fn(), ms))
      agenda(650, () => montarDesenho(FORMAS[0].d, 35)) // o foguete vira o M da MTABI
      agenda(2900, explodir)
    }
    capa.raf = requestAnimationFrame(quadro)
  }
  function explodir() {
    const centro = 2 * PASSO + 54
    som.explosao()
    onda(centro, centro)
    for (let k = 0; k < 40; k++) {
      const ang = Math.random() * Math.PI * 2
      const dist = sorteio(250, 900)
      particula('fogo', centro, centro, Math.cos(ang) * dist, Math.sin(ang) * dist, sorteio(40, 110), sorteio(500, 900))
    }
    capa.pecas.forEach((p) => {
      if (p.style.opacity !== '1') return
      const m = p.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)
      const x = m ? +m[1] + 54 - centro : 0
      const y = m ? +m[2] + 54 - centro : 0
      const ang = Math.atan2(y, x) + sorteio(-0.35, 0.35)
      const dist = sorteio(1300, 2000)
      p.style.transitionDelay = '0ms'
      p.style.transition = 'transform 1s cubic-bezier(0.12, 0.8, 0.25, 1), opacity 0.9s ease'
      p.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) rotate(${sorteio(-540, 540)}deg) scale(${sorteio(0.4, 1.3)})`
      p.style.opacity = '0'
    })
    capa.timers.push(setTimeout(() => slides[1].classList.remove('pousando'), 180))
    capa.timers.push(setTimeout(terminarPouso, 1300))
  }

  // Linha do tempo: anel em duas metades que se desenham a partir do ponto em que a linha toca
  document.querySelectorAll('.historia .selo').forEach((s) => {
    s.insertAdjacentHTML(
      'beforeend',
      '<svg class="anel" viewBox="0 0 96 96" aria-hidden="true"><path d="M1.5 48 A46.5 46.5 0 0 1 94.5 48"/><path d="M1.5 48 A46.5 46.5 0 0 0 94.5 48"/></svg>',
    )
  })

  // Marco 5: o M montado bloco a bloco dentro do círculo, como na capa
  document.querySelectorAll('.historia .selo[data-marco="5"]').forEach((s) => {
    const img = s.querySelector('img')
    if (img) img.remove()
    const m = document.createElement('span')
    m.className = 'mini-m'
    let k = 0
    '1...1 1..11 11..1 1.111 111.1'.replace(/ /g, '').split('').forEach((e) => {
      const i = document.createElement('i')
      if (e === '1') {
        i.className = 'b'
        i.style.setProperty('--k', k++)
      }
      m.appendChild(i)
    })
    s.insertBefore(m, s.firstChild)
  })

  // Marcos 3 e 4: um logo grande no centro, os outros orbitando por cima; troca a cada 1,6 s
  document.querySelectorAll('.historia .selo--mosaico, .historia .selo--dupla').forEach((s) => {
    const imgs = Array.from(s.querySelectorAll('img'))
    const li = s.closest('li')
    const C = 45 // centro do círculo (96 − 2 × 3 de borda) / 2
    let vez = 0
    s.classList.add('orbita')
    const posicionar = () => {
      imgs.forEach((im, i) => {
        const ordem = (i - vez + imgs.length) % imgs.length
        let x = C
        let y = C
        let t = 58
        if (ordem > 0) {
          const n = imgs.length - 1
          const graus = n === 1 ? -90 : -150 + ((ordem - 1) * 120) / (n - 1)
          x = C + 80 * Math.cos((graus * Math.PI) / 180)
          y = C + 80 * Math.sin((graus * Math.PI) / 180)
          t = 30
        }
        im.style.left = `${x - t / 2}px`
        im.style.top = `${y - t / 2}px`
        im.style.width = `${t}px`
        im.style.height = `${t}px`
        im.classList.toggle('satelite', ordem > 0)
      })
    }
    posicionar()
    setInterval(() => {
      if (!li.classList.contains('on')) return
      vez = (vez + 1) % imgs.length
      posicionar()
    }, 1600)
  })

  // Vídeo da evolução: o ano ao lado acende conforme o trecho que está passando; clique pausa/continua
  document.querySelectorAll('.ad__video').forEach((caixa) => {
    const v = caixa.querySelector('video')
    const anos = Array.from(caixa.querySelectorAll('.ad__anos li'))
    const marcar = () => {
      const i = anos.findIndex((li) => v.currentTime < +li.dataset.ate)
      anos.forEach((li, k) => li.classList.toggle('on', k === i))
    }
    v.addEventListener('timeupdate', marcar)
    v.addEventListener('seeked', marcar)
    const alternar = (e) => {
      e.stopPropagation()
      v.muted = false
      v.paused ? v.play() : v.pause()
    }
    v.addEventListener('click', alternar)
    const play = caixa.querySelector('.ad__play')
    if (play) play.addEventListener('click', alternar)
    // o botão grande aparece sempre que o vídeo está parado
    const estado = () => caixa.classList.toggle('tocando', !v.paused)
    v.addEventListener('play', estado)
    v.addEventListener('pause', estado)
    v.addEventListener('ended', () => { v.currentTime = 0; estado() })
    marcar()
  })

  // Vídeos na moldura de celular: clique pausa/continua sem avançar o slide.
  // Os de play manual (.tela-manual) ganham o botão grande, que some enquanto toca.
  document.querySelectorAll('.fl__celular video').forEach((v) => {
    const alternar = (e) => {
      e.stopPropagation()
      v.muted = false
      v.paused ? v.play() : v.pause()
    }
    v.addEventListener('click', alternar)
    const tela = v.closest('.tela-manual')
    if (!tela) return
    const play = tela.querySelector('.ad__play')
    if (play) play.addEventListener('click', alternar)
    const estado = () => tela.classList.toggle('tocando', !v.paused)
    v.addEventListener('play', estado)
    v.addEventListener('pause', estado)
  })

  // ---------- Antigravity: timelapse da ferramenta e, no fim, a prévia do protótipo ----------
  const ide = (() => {
    const raiz = document.querySelector('.ide')
    if (!raiz) return { iniciar() {}, parar() {} }
    const lapso = raiz.querySelector('.ide__timelapse')
    const previa = raiz.querySelector('.ide__previa video')
    function parar() {
      raiz.classList.remove('previa-aberta')
      ;[lapso, previa].forEach((v) => { v.pause(); v.currentTime = 0 })
    }
    function iniciar() {
      parar()
      lapso.play().catch(() => {})
    }
    // terminou o timelapse: a prévia do navegador sobe com o protótipo rodando
    lapso.addEventListener('ended', () => {
      raiz.classList.add('previa-aberta')
      previa.play().catch(() => {})
    })
    raiz.addEventListener('click', (e) => {
      e.stopPropagation()
      iniciar()
    })
    return { iniciar, parar }
  })()

  // ---------- Escala: o palco é 1920×1080 e cabe inteiro em qualquer tela ----------
  function encaixar(el, caixa) {
    const w = caixa.clientWidth
    const h = caixa.clientHeight
    const s = Math.min(w / 1920, h / 1080)
    el.style.transform = `translate(${(w - 1920 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`
    el.style.left = '0'
    el.style.top = '0'
  }
  function encaixarTudo() {
    if (apresentador) {
      encaixar(stage, document.getElementById('pv-atual-box'))
      const clone = document.querySelector('#pv-prox-box .pv-clone')
      if (clone) encaixar(clone, document.getElementById('pv-prox-box'))
    } else {
      encaixar(stage, document.getElementById('viewport'))
    }
  }
  window.addEventListener('resize', encaixarTudo)

  // ---------- Mostrar ----------
  function mostrar(i, p, avisar) {
    atual = Math.max(0, Math.min(total - 1, i))
    passo = Math.max(0, Math.min(passos(atual), p))
    slides.forEach((s, k) => s.classList.toggle('ativo', k === atual))
    slides[atual].querySelectorAll('.f').forEach((f, k) => f.classList.toggle('on', k < passo))
    slides[atual].style.setProperty('--passo', passo) // a linha do tempo corre até o marco do passo

    document.getElementById('contador').textContent = `${doisDigitos(atual + 1)} / ${total}`
    document.getElementById('progresso').style.width = `${((atual + 1) / total) * 100}%`
    document.body.classList.toggle('na-capa', atual === 0 || atual === total - 1) // capa e fim sem rodapé
    document.title = `${doisDigitos(atual + 1)} · ${slides[atual].dataset.titulo} · IA na Prática`
    history.replaceState(null, '', `${location.search}#/${atual + 1}`)

    // Vídeos: tocam do início quando o quadro deles aparece; os demais param.
    // No slide antes × agora, o passo diz qual par está na tela.
    if (!apresentador) {
      document.querySelectorAll('#stage video').forEach((v) => {
        const slide = v.closest('.slide')
        const par = v.closest('.ad__par')
        let visivel = slide === slides[atual]
        if (visivel && par) visivel = Array.from(slide.querySelectorAll('.ad__par')).indexOf(par) === passo
        if (v.hasAttribute('data-manual')) {
          // vídeo de play manual: ao entrar no slide volta ao início, parado, esperando o clique
          if (!visivel && !v.paused) v.pause()
          if (visivel && v.paused) v.currentTime = 0
          return
        }
        if (visivel && v.paused) {
          v.currentTime = 0
          v.play().catch(() => {
            v.muted = true
            v.play().catch(() => {})
          })
        } else if (!visivel && !v.paused) v.pause()
      })
    }
    // números que contam do zero quando o passo deles aparece (e voltam a zero quando somem)
    // fora do slide atual, zera, para contar de novo quando voltar
    slides.forEach((s, k) => {
      if (k !== atual) s.querySelectorAll('[data-conta], [data-preco]').forEach((el) => delete el.dataset.contou)
    })
    // preços como taxímetro: rolam de zero até o valor, cada um com seu atraso
    slides[atual].querySelectorAll('[data-preco]').forEach((el) => {
      if (el.dataset.contou) return
      el.dataset.contou = '1'
      const alvo = +el.dataset.preco
      const moeda = el.dataset.moeda
      const centavos = !Number.isInteger(alvo)
      const fmt = (v) => `${moeda} ${centavos ? v.toFixed(2).replace('.', ',') : Math.round(v)}`
      el.textContent = fmt(0)
      setTimeout(() => {
        const t0 = performance.now()
        const quadro = (agora) => {
          if (!el.dataset.contou) return
          const p = Math.min(1, (agora - t0) / 900)
          el.textContent = fmt(alvo * (1 - Math.pow(1 - p, 3)))
          if (p < 1) requestAnimationFrame(quadro)
        }
        requestAnimationFrame(quadro)
      }, +el.dataset.atraso || 0)
    })
    slides[atual].querySelectorAll('[data-conta]').forEach((el) => {
      const ligado = el.closest('.f') ? el.closest('.f').classList.contains('on') : true
      const alvo = +el.dataset.conta
      if (ligado && !el.dataset.contou) {
        el.dataset.contou = '1'
        const t0 = performance.now()
        const passoConta = (agora) => {
          const p = Math.min(1, (agora - t0) / 1100)
          const suave = 1 - Math.pow(1 - p, 3)
          el.textContent = `${Math.round(alvo * suave)}%`
          if (p < 1 && el.dataset.contou) requestAnimationFrame(passoConta)
        }
        requestAnimationFrame(passoConta)
      } else if (!ligado) {
        delete el.dataset.contou
        el.textContent = '0%'
      }
    })
    // encenação do Antigravity: começa ao entrar no slide, para ao sair
    if (slides[atual].dataset.animacao === 'ide') {
      if (!ideRodando) { ideRodando = true; ide.iniciar() }
    } else if (ideRodando) { ideRodando = false; ide.parar() }
    if (capa.pouso) terminarPouso()
    atual === 0 ? iniciarCapa() : pararCapa()
    if (apresentador) atualizarApresentador()
    if (avisar && canal) canal.postMessage({ t: 'ir', i: atual, p: passo })
  }

  // ---------- Varredura de blocos: transição curta entre slides ----------
  // Uma onda diagonal de blocos cobre a tela, o slide troca por baixo, e a onda segue descobrindo.
  const COLS = 16
  const LINS = 9
  const ATRASO = 14 // ms por passo da diagonal
  const cortina = document.createElement('div')
  cortina.className = 'cortina'
  for (let l = 0; l < LINS; l++) {
    for (let c = 0; c < COLS; c++) {
      const i = document.createElement('i')
      i.style.setProperty('--d', `${(c + l) * ATRASO}ms`)
      if (Math.random() < 0.1) i.className = 'ambar'
      cortina.appendChild(i)
    }
  }
  stage.appendChild(cortina)
  let varrendo = false
  function varrer(trocar) {
    if (varrendo) return
    varrendo = true
    const cobrir = (COLS + LINS - 2) * ATRASO + 260
    cortina.classList.remove('sair')
    cortina.classList.add('ativa')
    void cortina.offsetWidth
    cortina.classList.add('cobrir')
    setTimeout(() => {
      trocar()
      cortina.classList.add('sair')
      cortina.classList.remove('cobrir')
      setTimeout(() => {
        cortina.classList.remove('ativa', 'sair')
        varrendo = false
      }, cobrir + 40)
    }, cobrir)
  }
  // ---------- Meses passando: transição para o slide "em maio eu mostrei estes nomes" ----------
  const MESES = ['Maio', 'Junho', 'Julho', 'Agosto', 'Setembro']
  const relogio = document.createElement('div')
  relogio.className = 'relogio'
  relogio.innerHTML = '<span class="relogio__ano">2026</span><div class="relogio__mes"></div><div class="relogio__pontos">' + MESES.map(() => '<i></i>').join('') + '</div>'
  stage.appendChild(relogio)
  const relogioMes = relogio.querySelector('.relogio__mes')
  const relogioPontos = Array.from(relogio.querySelectorAll('.relogio__pontos i'))
  function passarMeses(trocar) {
    if (varrendo) return
    varrendo = true
    relogioMes.innerHTML = ''
    relogioPontos.forEach((p) => p.classList.remove('on'))
    relogio.classList.add('ativa')
    const PASSO_MES = 260
    MESES.forEach((nome, k) => {
      setTimeout(() => {
        const velho = relogioMes.querySelector('span:not(.sai)')
        if (velho) {
          velho.classList.add('sai')
          setTimeout(() => velho.remove(), 300)
        }
        const novo = document.createElement('span')
        novo.textContent = nome
        if (k === MESES.length - 1) novo.className = 'ultimo'
        relogioMes.appendChild(novo)
        relogioPontos[k].classList.add('on')
      }, 220 + k * PASSO_MES)
    })
    const fim = 220 + MESES.length * PASSO_MES + 450
    setTimeout(() => {
      trocar()
      relogio.classList.remove('ativa')
      setTimeout(() => { varrendo = false }, 400)
    }, fim)
  }

  // ---------- Porta dupla: dois painéis fecham no meio, a fenda acende, e abrem no slide novo ----------
  const portas = document.createElement('div')
  portas.className = 'portas'
  portas.innerHTML = '<i class="porta porta--e"></i><i class="porta porta--d"></i><i class="fenda"></i>'
  stage.appendChild(portas)
  function abrirPortas(trocar) {
    if (varrendo) return
    varrendo = true
    portas.classList.remove('abrir')
    portas.classList.add('ativa')
    void portas.offsetWidth
    portas.classList.add('fechar')
    setTimeout(() => {
      trocar()
      portas.classList.add('abrir')
      portas.classList.remove('fechar')
      setTimeout(() => {
        portas.classList.remove('ativa', 'abrir')
        varrendo = false
      }, 560)
    }, 620)
  }

  // ---------- Interrogação de blocos: um "?" se monta e se desfaz (slide do 38%) ----------
  const PERGUNTA = ['.111.', '1...1', '....1', '..11.', '..1..', '.....', '..1..']
  const interrog = document.createElement('div')
  interrog.className = 'interrog'
  const grade = document.createElement('div')
  grade.className = 'interrog__grade'
  let nBloco = 0
  PERGUNTA.forEach((linha) => {
    ;[...linha].forEach((e) => {
      const i = document.createElement('i')
      if (e === '1') {
        i.className = 'b'
        i.style.setProperty('--k', nBloco++)
        i.style.setProperty('--sx', `${Math.round((Math.random() - 0.5) * 900)}px`)
        i.style.setProperty('--sy', `${Math.round((Math.random() - 0.5) * 700)}px`)
        i.style.setProperty('--sr', `${Math.round((Math.random() - 0.5) * 300)}deg`)
      }
      grade.appendChild(i)
    })
  })
  interrog.appendChild(grade)
  stage.appendChild(interrog)
  function montarPergunta(trocar) {
    if (varrendo) return
    varrendo = true
    interrog.classList.remove('desfaz')
    interrog.classList.add('ativa')
    void interrog.offsetWidth
    interrog.classList.add('monta')
    setTimeout(() => {
      trocar()
      interrog.classList.add('desfaz')
      setTimeout(() => {
        interrog.classList.remove('ativa', 'monta', 'desfaz')
        varrendo = false
      }, 650)
    }, 950)
  }

  // ---------- Três cortinas: uma por ferramenta do comparativo, descem e sobem em sequência ----------
  const tres = document.createElement('div')
  tres.className = 'tres-cortinas'
  tres.innerHTML = '<i></i><i></i><i></i>'
  stage.appendChild(tres)
  function descerCortinas(trocar) {
    if (varrendo) return
    varrendo = true
    tres.classList.remove('sobe')
    tres.classList.add('ativa')
    void tres.offsetWidth
    tres.classList.add('desce')
    setTimeout(() => {
      trocar()
      tres.classList.add('sobe')
      setTimeout(() => {
        tres.classList.remove('ativa', 'desce', 'sobe')
        varrendo = false
      }, 700)
    }, 640)
  }

  // ---------- Clarão: a tela acende e a luz se fecha até virar a bola do Zé ----------
  const clarao = document.createElement('div')
  clarao.className = 'clarao'
  stage.appendChild(clarao)
  function acenderClarao(trocar) {
    if (varrendo) return
    varrendo = true
    clarao.className = 'clarao ativa'
    void clarao.offsetWidth
    clarao.classList.add('acende')
    setTimeout(() => {
      trocar()
      clarao.classList.add('reduz')
      setTimeout(() => {
        clarao.classList.add('some')
        setTimeout(() => {
          clarao.className = 'clarao'
          varrendo = false
        }, 450)
      }, 950)
    }, 260)
  }

  // ---------- Página de caderno virando (→ Gemini Notebook) ----------
  const folha = document.createElement('div')
  folha.className = 'folha'
  folha.innerHTML = '<i></i>'
  stage.appendChild(folha)
  function virarPagina(trocar) {
    if (varrendo) return
    varrendo = true
    folha.className = 'folha ativa'
    void folha.offsetWidth
    folha.classList.add('cobre')
    setTimeout(() => {
      trocar()
      folha.classList.add('vira')
      setTimeout(() => {
        folha.className = 'folha'
        varrendo = false
      }, 620)
    }, 600)
  }

  // ---------- Arcos do Gemini Notebook: desenham grandes e encolhem até o logo do slide ----------
  const arcos = document.createElement('div')
  arcos.className = 'arcos'
  const arco = (r, cor) => {
    const cx = 960
    const cy = 600
    return `<path d="M${cx - r} 900 L${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy} L${cx + r} 900" stroke="${cor}" pathLength="1"/>`
  }
  arcos.innerHTML = `<svg viewBox="0 0 1920 1080" aria-hidden="true"><g class="arcos__g">${arco(520, '#3d85ff')}${arco(390, '#72b0ff')}${arco(260, '#b1a9ff')}</g></svg>`
  stage.appendChild(arcos)
  function desenharArcos(trocar) {
    if (varrendo) return
    varrendo = true
    arcos.className = 'arcos ativa'
    void arcos.offsetWidth
    arcos.classList.add('desenha')
    setTimeout(() => {
      trocar()
      arcos.classList.add('encolhe')
      setTimeout(() => {
        arcos.className = 'arcos'
        varrendo = false
      }, 800)
    }, 900)
  }

  // ---------- Onda: sobe do rodapé, cobre a tela e sai pelo topo (→ "cada uma tem a sua praia") ----------
  const ondaT = document.createElement('div')
  ondaT.className = 'onda-t'
  ondaT.innerHTML = '<i class="onda-t__tras"></i><i class="onda-t__frente"></i>'
  stage.appendChild(ondaT)
  function subirOnda(trocar) {
    if (varrendo) return
    varrendo = true
    ondaT.className = 'onda-t ativa'
    void ondaT.offsetWidth
    ondaT.classList.add('cobre')
    setTimeout(() => {
      trocar()
      ondaT.classList.add('sai')
      setTimeout(() => {
        ondaT.className = 'onda-t'
        varrendo = false
      }, 700)
    }, 650)
  }

  // ---------- Película de cinema atravessando a tela (→ Google Flow) ----------
  // A fita tem duas telas de largura: cobre tudo no meio do trajeto, e é aí que o slide troca.
  const pelicula = document.createElement('div')
  pelicula.className = 'pelicula'
  pelicula.innerHTML = '<i></i>'
  stage.appendChild(pelicula)
  function passarPelicula(trocar) {
    if (varrendo) return
    varrendo = true
    pelicula.className = 'pelicula ativa'
    void pelicula.offsetWidth
    pelicula.classList.add('passa')
    setTimeout(trocar, 700)
    setTimeout(() => {
      pelicula.className = 'pelicula'
      varrendo = false
    }, 1450)
  }

  // ---------- Linha do tempo de editor de vídeo (→ "editam como ninguém") ----------
  // Quatro faixas de clipes entram por lados alternados, a agulha varre, e as faixas saem.
  const editor = document.createElement('div')
  editor.className = 'editor'
  for (let f = 0; f < 4; f++) {
    const faixa = document.createElement('div')
    faixa.className = 'editor__faixa'
    let x = 0
    while (x < 2000) {
      const w = 140 + Math.round(Math.random() * 320)
      const clip = document.createElement('i')
      clip.style.width = `${w}px`
      if (Math.random() < 0.28) clip.className = 'ambar'
      faixa.appendChild(clip)
      x += w + 10
    }
    editor.appendChild(faixa)
  }
  editor.insertAdjacentHTML('beforeend', '<b class="editor__agulha"></b>')
  stage.appendChild(editor)
  function montarEdicao(trocar) {
    if (varrendo) return
    varrendo = true
    editor.className = 'editor ativa'
    void editor.offsetWidth
    editor.classList.add('entra')
    setTimeout(() => {
      trocar()
      editor.classList.add('sai')
      setTimeout(() => {
        editor.className = 'editor'
        varrendo = false
      }, 600)
    }, 900)
  }

  // ---------- Gravidade zero: o logo do Antigravity sobe acelerando, com blocos subindo junto ----------
  const gravidade = document.createElement('div')
  gravidade.className = 'gravidade'
  let blocosG = ''
  for (let k = 0; k < 26; k++) {
    const x = Math.round(Math.random() * 1880)
    const s = 20 + Math.round(Math.random() * 60)
    const d = Math.round(Math.random() * 350)
    const r = Math.round((Math.random() - 0.5) * 540)
    const cls = Math.random() < 0.35 ? ' class="ambar"' : ''
    blocosG += `<i style="left:${x}px;width:${s}px;height:${s}px;--d:${d}ms;--r:${r}deg"${cls}></i>`
  }
  gravidade.innerHTML = blocosG + '<img src="assets/logos/antigravity.png" alt="">'
  stage.appendChild(gravidade)
  function gravidadeZero(trocar) {
    if (varrendo) return
    varrendo = true
    gravidade.className = 'gravidade ativa'
    void gravidade.offsetWidth
    gravidade.classList.add('sobe')
    setTimeout(() => {
      trocar()
      gravidade.classList.add('sai')
      setTimeout(() => {
        gravidade.className = 'gravidade'
        varrendo = false
      }, 700)
    }, 800)
  }

  // ---------- Velocidade em blocos: trens de quadradinhos riscando a tela (→ "IA é acelerador") ----------
  // Cada trem: bloco da frente forte e a cauda se apagando, no padrão de blocos da marca.
  const veloc = document.createElement('div')
  veloc.className = 'veloc veloc--blocos'
  let riscos = ''
  for (let k = 0; k < 22; k++) {
    const t = 14 + Math.round(Math.random() * 30) // tamanho do bloco
    const y = Math.round(Math.random() * (1080 - t))
    const n = 5 + Math.round(Math.random() * 9) // blocos no trem
    const d = Math.round(Math.random() * 280)
    const cls = Math.random() < 0.35 ? ' class="ambar"' : ''
    let trem = ''
    for (let b = 0; b < n; b++) trem += `<b style="opacity:${(1 - b / n).toFixed(2)}"></b>`
    riscos += `<i style="top:${y}px;--t:${t}px;--d:${d}ms"${cls}>${trem}</i>`
  }
  veloc.innerHTML = riscos
  stage.appendChild(veloc)
  function acelerar(trocar) {
    if (varrendo) return
    varrendo = true
    veloc.className = 'veloc veloc--blocos ativa'
    void veloc.offsetWidth
    veloc.classList.add('risca')
    setTimeout(() => {
      trocar()
      veloc.classList.add('sai')
      setTimeout(() => {
        veloc.className = 'veloc veloc--blocos'
        varrendo = false
      }, 550)
    }, 560)
  }

  // ---------- A bagunça se arruma: blocos em caos encaixam numa fila (→ Método) ----------
  const arrumar = document.createElement('div')
  arrumar.className = 'arrumar'
  let pecasA = ''
  for (let k = 0; k < 20; k++) {
    const x = 220 + k * 74
    const dx = Math.round((Math.random() - 0.5) * 1500 + (960 - x) * 0.2)
    const dy = Math.round((Math.random() - 0.5) * 800)
    const r = Math.round((Math.random() - 0.5) * 300)
    const cls = k % 4 === 1 ? ' class="ambar"' : ''
    pecasA += `<i style="left:${x}px;--dx:${dx}px;--dy:${dy}px;--r:${r}deg;--k:${k}"${cls}></i>`
  }
  arrumar.innerHTML = pecasA
  stage.appendChild(arrumar)
  function arrumarBagunca(trocar) {
    if (varrendo) return
    varrendo = true
    arrumar.className = 'arrumar ativa'
    void arrumar.offsetWidth
    arrumar.classList.add('caos')
    setTimeout(() => arrumar.classList.add('ordem'), 550)
    setTimeout(() => {
      trocar()
      arrumar.classList.add('sai')
      setTimeout(() => {
        arrumar.className = 'arrumar'
        varrendo = false
      }, 550)
    }, 1300)
  }

  // transição usada ao AVANÇAR até cada slide (índice): voltar é sempre direto
  // ---------- Estrela do Gemini: blocos formam a estrela e explodem (→ Google AI Pro) ----------
  const ESTRELA = ['....1....', '....1....', '...111...', '..11111..', '111111111', '..11111..', '...111...', '....1....', '....1....']
  const estrela = document.createElement('div')
  estrela.className = 'estrela'
  const corEstrela = (t) => {
    // azul → roxo → rosa, como o gradiente do Gemini
    const c = [[79, 139, 255], [166, 107, 255], [255, 126, 179]]
    const seg = t < 0.5 ? 0 : 1
    const u = t < 0.5 ? t * 2 : (t - 0.5) * 2
    return `rgb(${c[seg].map((v, k) => Math.round(v + (c[seg + 1][k] - v) * u)).join(',')})`
  }
  let blocosE = ''
  ESTRELA.forEach((linha, l) => {
    ;[...linha].forEach((e, c) => {
      if (e !== '1') return
      const x = 960 - 315 + c * 70
      const y = 540 - 315 + l * 70
      const ang = Math.atan2(y + 30 - 540, x + 30 - 960) + (Math.random() - 0.5) * 0.4
      const dist = 900 + Math.random() * 700
      const sx = Math.round((Math.random() - 0.5) * 2000)
      const sy = Math.round((Math.random() - 0.5) * 1300)
      blocosE += `<i style="left:${x}px;top:${y}px;background:${corEstrela((c + l) / 16)};--sx:${sx}px;--sy:${sy}px;--ex:${Math.round(Math.cos(ang) * dist)}px;--ey:${Math.round(Math.sin(ang) * dist)}px;--r:${Math.round((Math.random() - 0.5) * 500)}deg;--k:${l * 9 + c}"></i>`
    })
  })
  estrela.innerHTML = blocosE + '<b class="estrela__clarao"></b>'
  stage.appendChild(estrela)
  function explodirEstrela(trocar) {
    if (varrendo) return
    varrendo = true
    estrela.className = 'estrela ativa'
    void estrela.offsetWidth
    estrela.classList.add('forma')
    setTimeout(() => estrela.classList.add('pulsa'), 1000)
    setTimeout(() => {
      trocar()
      estrela.classList.add('explode')
      setTimeout(() => {
        estrela.className = 'estrela'
        varrendo = false
      }, 900)
    }, 1450)
  }

  // ---------- Nascer do sol em blocos, no estilo da marca (→ "já amanhã") ----------
  // Disco de 11×11 blocos (mais claro no centro) e 8 raios de 3 blocos; sobe, os raios acendem, e tudo se espalha.
  const sol = document.createElement('div')
  sol.className = 'sol sol--blocos'
  const PASSO_SOL = 56
  let blocosSol = ''
  for (let l = -5; l <= 5; l++) {
    for (let c = -5; c <= 5; c++) {
      const d = Math.hypot(l, c)
      if (d > 5.3) continue
      const cor = d < 2 ? 'var(--cream)' : d < 3.6 ? '#f4c86a' : 'var(--amber)'
      const ang = Math.atan2(l, c) + (Math.random() - 0.5) * 0.5
      const dist = 700 + Math.random() * 900
      blocosSol += `<i style="left:${c * PASSO_SOL}px;top:${l * PASSO_SOL}px;background:${cor};--ex:${Math.round(Math.cos(ang) * dist)}px;--ey:${Math.round(Math.sin(ang) * dist)}px;--r:${Math.round((Math.random() - 0.5) * 400)}deg"></i>`
    }
  }
  for (let r = 0; r < 8; r++) {
    const a = (r * Math.PI) / 4
    for (let s = 0; s < 3; s++) {
      const dd = 7 + s * 1.15
      const ang = a + (Math.random() - 0.5) * 0.3
      const dist = 800 + Math.random() * 800
      blocosSol += `<i class="raio" style="left:${Math.round(Math.cos(a) * dd * PASSO_SOL)}px;top:${Math.round(Math.sin(a) * dd * PASSO_SOL)}px;--k:${r * 3 + s};--ex:${Math.round(Math.cos(ang) * dist)}px;--ey:${Math.round(Math.sin(ang) * dist)}px;--r:${Math.round((Math.random() - 0.5) * 400)}deg"></i>`
    }
  }
  sol.innerHTML = `<div class="sol__corpo">${blocosSol}</div>`
  stage.appendChild(sol)
  function nascerSol(trocar) {
    if (varrendo) return
    varrendo = true
    sol.className = 'sol sol--blocos ativa' // manter sol--blocos: é ela que liga o estilo de blocos
    void sol.offsetWidth
    sol.classList.add('nasce')
    // 1) o sol se expande e se dissolve ainda sobre o fundo escuro
    setTimeout(() => sol.classList.add('clareia'), 1300)
    // 2) só com os blocos já sumidos o slide troca e o fundo sai, para o texto entrar limpo
    setTimeout(() => {
      trocar()
      sol.classList.add('abre')
      setTimeout(() => {
        sol.className = 'sol sol--blocos'
        varrendo = false
      }, 450)
    }, 2250)
  }

  // ---------- Onda em blocos: colunas sobem em ondulação com crista âmbar (→ "a sua praia") ----------
  const ondaB = document.createElement('div')
  ondaB.className = 'ondab'
  let colunas = ''
  for (let c = 0; c < 24; c++) {
    // atraso em seno: cada coluna chega num tempo diferente e o topo forma a onda
    const atraso = Math.round((Math.sin(c * 0.55) + 1) * 110 + c * 14)
    let pilha = '<b class="crista"></b>'
    for (let l = 0; l < 13; l++) pilha += '<b></b>'
    colunas += `<i style="left:${c * 80}px;--d:${atraso}ms">${pilha}</i>`
  }
  ondaB.innerHTML = colunas
  stage.appendChild(ondaB)
  function subirOndaBlocos(trocar) {
    if (varrendo) return
    varrendo = true
    ondaB.className = 'ondab ativa'
    void ondaB.offsetWidth
    ondaB.classList.add('cobre')
    setTimeout(() => {
      trocar()
      ondaB.classList.add('sai')
      setTimeout(() => {
        ondaB.className = 'ondab'
        varrendo = false
      }, 950)
    }, 950)
  }

  // ---------- Portas em blocos: fileiras de blocos fecham do lado, costura âmbar, e abrem (→ "O dono já usa") ----------
  const portasB = document.createElement('div')
  portasB.className = 'portasb'
  let fileiras = ''
  for (let l = 0; l < 13; l++) {
    const d = Math.round(Math.random() * 120 + Math.abs(l - 6) * 18)
    let esq = ''
    let dir = ''
    for (let c = 0; c < 12; c++) {
      esq += c === 11 ? '<b class="costura"></b>' : '<b></b>'
      dir += c === 0 ? '<b class="costura"></b>' : '<b></b>'
    }
    fileiras += `<i class="e" style="top:${l * 84}px;--d:${d}ms">${esq}</i><i class="d" style="top:${l * 84}px;--d:${d}ms">${dir}</i>`
  }
  portasB.innerHTML = fileiras
  stage.appendChild(portasB)
  function fecharPortasBlocos(trocar) {
    if (varrendo) return
    varrendo = true
    portasB.className = 'portasb ativa'
    void portasB.offsetWidth
    portasB.classList.add('fecha')
    setTimeout(() => {
      trocar()
      portasB.classList.add('abre')
      setTimeout(() => {
        portasB.className = 'portasb'
        varrendo = false
      }, 750)
    }, 850)
  }

  // ---------- Clarão em blocos: a tela se enche do centro para fora e se recolhe na bola do Zé ----------
  // Centro da bola no slide do Zé: x 960, y 421 (39% da altura).
  const claraoB = document.createElement('div')
  claraoB.className = 'claraob'
  let celulasC = ''
  const CX = 960
  const CY = 421
  const MAXD = Math.hypot(1000, 700)
  for (let l = 0; l < 12; l++) {
    for (let c = 0; c < 20; c++) {
      const x = c * 96 + 4
      const y = l * 96 + 4 - 24
      const d = Math.min(1, Math.hypot(x + 44 - CX, y + 44 - CY) / MAXD)
      const cor = d < 0.14 ? '#ffffff' : d < 0.3 ? '#dfe7ff' : d < 0.48 ? '#9fb4ff' : d < 0.68 ? '#7f8cff' : '#8a5cf0'
      celulasC += `<i style="left:${x}px;top:${y}px;background:${cor};--d:${d.toFixed(3)};--tx:${Math.round(CX - x - 44)}px;--ty:${Math.round(CY - y - 44)}px"></i>`
    }
  }
  claraoB.innerHTML = celulasC
  stage.appendChild(claraoB)
  function claraoBlocos(trocar) {
    if (varrendo) return
    varrendo = true
    claraoB.className = 'claraob ativa'
    void claraoB.offsetWidth
    claraoB.classList.add('acende')
    setTimeout(() => {
      trocar()
      claraoB.classList.add('recolhe')
      setTimeout(() => {
        claraoB.className = 'claraob'
        varrendo = false
      }, 1050)
    }, 750)
  }

  // ---------- Arcos do Notebook em blocos: desenhados bloco a bloco e encolhendo até o logo ----------
  const arcosB = document.createElement('div')
  arcosB.className = 'arcosb'
  let blocosA = ''
  ;[[520, '#3d85ff', 0], [390, '#72b0ff', 1], [260, '#b1a9ff', 2]].forEach(([r, cor, n]) => {
    const pts = []
    const P = 60
    for (let y = 900; y > 600; y -= P) pts.push([960 - r, y])
    const passos = Math.max(6, Math.round((Math.PI * r) / P))
    for (let s = 0; s <= passos; s++) {
      const a = Math.PI - (s / passos) * Math.PI
      pts.push([960 + Math.cos(a) * r, 600 - Math.sin(a) * r])
    }
    for (let y = 600 + P; y <= 900; y += P) pts.push([960 + r, y])
    pts.forEach(([x, y], k) => {
      blocosA += `<i style="left:${Math.round(x - 26)}px;top:${Math.round(y - 26)}px;background:${cor};--k:${k};--n:${n}"></i>`
    })
  })
  arcosB.innerHTML = `<div class="arcosb__g">${blocosA}</div>`
  stage.appendChild(arcosB)
  function arcosBlocos(trocar) {
    if (varrendo) return
    varrendo = true
    arcosB.className = 'arcosb ativa'
    void arcosB.offsetWidth
    arcosB.classList.add('desenha')
    setTimeout(() => {
      trocar()
      arcosB.classList.add('encolhe')
      setTimeout(() => {
        arcosB.className = 'arcosb'
        varrendo = false
      }, 800)
    }, 1150)
  }

  // ---------- Película em blocos: furos e quadros feitos de blocos atravessando a tela (→ Flow) ----------
  const peliculaB = document.createElement('div')
  peliculaB.className = 'peliculab'
  let furos = ''
  for (let k = 0; k < 48; k++) furos += '<b></b>'
  let quadros = ''
  for (let k = 0; k < 6; k++) quadros += '<i></i>'
  peliculaB.innerHTML = `<div class="peliculab__fita"><div class="peliculab__furos">${furos}</div><div class="peliculab__quadros">${quadros}</div><div class="peliculab__furos">${furos}</div></div>`
  stage.appendChild(peliculaB)
  function peliculaBlocos(trocar) {
    if (varrendo) return
    varrendo = true
    peliculaB.className = 'peliculab ativa'
    void peliculaB.offsetWidth
    peliculaB.classList.add('passa')
    setTimeout(trocar, 700)
    setTimeout(() => {
      peliculaB.className = 'peliculab'
      varrendo = false
    }, 1450)
  }

  // ---------- Três cortinas de blocos: paredes de quadradinhos com barra âmbar (→ preços) ----------
  const cortinas3 = document.createElement('div')
  cortinas3.className = 'cortinas3'
  let paineis = ''
  for (let p = 0; p < 3; p++) {
    let blocos = ''
    for (let l = 0; l < 13; l++) {
      for (let c = 0; c < 8; c++) blocos += l === 12 ? '<b class="ambar"></b>' : '<b></b>'
    }
    paineis += `<i style="--p:${p}">${blocos}</i>`
  }
  cortinas3.innerHTML = paineis
  stage.appendChild(cortinas3)
  function cortinasBlocos(trocar) {
    if (varrendo) return
    varrendo = true
    cortinas3.className = 'cortinas3 ativa'
    void cortinas3.offsetWidth
    cortinas3.classList.add('desce')
    setTimeout(() => {
      trocar()
      cortinas3.classList.add('sobe')
      setTimeout(() => {
        cortinas3.className = 'cortinas3'
        varrendo = false
      }, 750)
    }, 780)
  }

  // pelo NOME do slide (data-titulo), para sobreviver a qualquer troca de ordem
  const TRANSICOES = {
    'Minha história com IA': varrer,
    'Setembro de 2026': passarMeses,
    'O dono já usa': fecharPortasBlocos,
    'O motivo': montarPergunta,
    'Cada uma tem a sua praia': subirOndaBlocos,
    'Zé': claraoBlocos,
    'Ao vivo: Gemini Notebook': arcosBlocos,
    'Google Flow': peliculaBlocos,
    'Editam como ninguém': montarEdicao,
    Antigravity: gravidadeZero,
    'IA é acelerador': acelerar,
    'Cada IA e quanto custa': cortinasBlocos,
    'Google AI Pro': explodirEstrela,
    'Já amanhã': nascerSol,
  }

  function avancar() {
    if (varrendo) return
    if (capa.pouso) {
      // pular a chegada: mostra o slide 2 já pronto
      som.parar()
      terminarPouso()
      return
    }
    if (atual === 0) {
      // primeiro clique: contagem e decolagem; segundo clique durante a contagem: pula direto
      if (capa.transicao) {
        som.parar()
        mostrar(1, 0, true)
      } else {
        som.destravar()
        contagemRegressiva()
        if (canal) canal.postMessage({ t: 'contagem' })
      }
      return
    }
    if (passo < passos(atual)) mostrar(atual, passo + 1, true)
    else if (atual < total - 1) {
      const proximo = atual + 1
      const efeito = TRANSICOES[slides[proximo].dataset.titulo]
      if (efeito) efeito(() => mostrar(proximo, 0, true))
      else mostrar(proximo, 0, true)
    }
  }
  function voltar() {
    if (passo > 0) mostrar(atual, passo - 1, true)
    else if (atual > 0) mostrar(atual - 1, passos(atual - 1), true)
  }

  if (canal) {
    canal.onmessage = (e) => {
      const m = e.data
      if (m.t === 'ir') mostrar(m.i, m.p, false)
      if (m.t === 'contagem' && atual === 0 && !capa.transicao) contagemRegressiva()
    }
  }

  // ---------- Teclado ----------
  let digitos = ''
  let digitosTimer
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Enter e espaço num botão acionam o botão, não o slide.
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest && e.target.closest('button, a')) return

    if (/^[0-9]$/.test(e.key)) {
      digitos += e.key
      clearTimeout(digitosTimer)
      digitosTimer = setTimeout(() => (digitos = ''), 1500)
      return
    }
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': case 'ArrowDown':
        e.preventDefault(); avancar(); break
      case 'ArrowLeft': case 'PageUp': case 'Backspace': case 'ArrowUp':
        e.preventDefault(); voltar(); break
      case 'Enter':
        if (digitos) { mostrar(parseInt(digitos, 10) - 1, 0, true); digitos = '' }
        else avancar()
        break
      case 'Home': mostrar(0, 0, true); break
      case 'End': mostrar(total - 1, 0, true); break
      case 'f': case 'F': telaCheia(); break
      case 'p': case 'P': abrirApresentador(); break
      case 'm': case 'M': som.alternarMudo(); break
      case 'l': case 'L':
        // Lançamento sob comando: monta o foguete e decola, na hora que o palestrante quiser.
        if (atual === 0) {
          pararCapa()
          capa.rodando = true
          capa.forma = FORMAS.findIndex((f) => f.nome === 'Master Club')
          som.destravar()
          capa.comSom = true
          capa.pecas.forEach((p) => espalhar(p, 0))
          capa.timers.push(setTimeout(cicloCapa, 700))
        }
        break
      case 'h': case 'H': case '?': {
        const a = document.getElementById('ajuda')
        a.hidden = !a.hidden
        break
      }
    }
  })

  // ---------- Clique e toque: terço esquerdo volta, o resto avança ----------
  const interativo = (el) => el.closest('a, button, .campo, #presenter .pv__lado')
  document.getElementById('viewport').addEventListener('click', (e) => {
    if (interativo(e.target) || apresentador) return
    const x = e.clientX / window.innerWidth
    x < 0.33 ? voltar() : avancar()
  })
  let toqueX = null
  document.addEventListener('touchstart', (e) => { toqueX = e.touches[0].clientX }, { passive: true })
  document.addEventListener('touchend', (e) => {
    if (toqueX === null) return
    const dx = e.changedTouches[0].clientX - toqueX
    toqueX = null
    if (Math.abs(dx) > 50) dx < 0 ? avancar() : voltar()
  })

  function telaCheia() {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen().catch(() => {})
  }

  // ---------- Modo apresentador ----------
  function abrirApresentador() {
    if (apresentador) return
    window.open(`${location.pathname}?apresentador#/${atual + 1}`, 'mtabi-apresentador', 'width=1400,height=860')
  }

  let inicio = null
  function atualizarApresentador() {
    document.getElementById('pv-slide').textContent = `${atual + 1} / ${total}`
    const notas = slides[atual].querySelector('.notes')
    document.getElementById('pv-notas').textContent = notas ? notas.textContent.trim().replace(/\s+/g, ' ') : ''

    // "Próximo" mostra o que a plateia vai ver no próximo clique: o passo seguinte ou o slide seguinte.
    const caixa = document.getElementById('pv-prox-box')
    caixa.innerHTML = ''
    let alvo = null
    let ligados = 0
    if (passo < passos(atual)) { alvo = slides[atual]; ligados = passo + 1 }
    else if (atual < total - 1) { alvo = slides[atual + 1] }
    if (alvo) {
      const clone = document.createElement('div')
      clone.className = 'pv-clone'
      clone.style.cssText = 'width:1920px;height:1080px;background:var(--bg);transform-origin:0 0'
      const s = alvo.cloneNode(true)
      s.classList.add('ativo')
      s.querySelectorAll('.f').forEach((f, k) => f.classList.toggle('on', k < ligados))
      s.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
      clone.appendChild(s)
      caixa.appendChild(clone)
    } else {
      caixa.innerHTML = '<p style="margin:0;padding:24px;color:var(--text-3);font-family:var(--font-mono)">Fim</p>'
    }
    if (inicio === null && atual > 0) inicio = Date.now()
    encaixarTudo()
  }

  if (apresentador) {
    document.body.classList.add('apresentador')
    const pv = document.getElementById('presenter')
    pv.hidden = false
    document.getElementById('pv-atual-box').appendChild(stage)
    document.getElementById('pv-ant').onclick = voltar
    document.getElementById('pv-prox').onclick = avancar
    document.getElementById('pv-zerar').onclick = () => { inicio = Date.now() }
    setInterval(() => {
      const seg = inicio ? Math.floor((Date.now() - inicio) / 1000) : 0
      document.getElementById('pv-tempo').textContent = `${doisDigitos(Math.floor(seg / 60))}:${doisDigitos(seg % 60)}`
      const d = new Date()
      document.getElementById('pv-relogio').textContent = `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`
    }, 500)
  }

  // ---------- Início ----------
  const slideDoEndereco = () => {
    const m = location.hash.match(/^#\/(\d+)/)
    return m ? parseInt(m[1], 10) - 1 : 0
  }
  window.addEventListener('hashchange', () => {
    const i = slideDoEndereco()
    if (i !== atual) mostrar(i, 0, true)
  })
  mostrar(slideDoEndereco(), 0, false)
  encaixarTudo()
  if (document.fonts) document.fonts.ready.then(encaixarTudo)
})()
