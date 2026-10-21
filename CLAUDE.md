# LanchaVR (Lanchas no Rio)

Corrida de lanchas em VR para o Meta Quest 3, no navegador do óculos (WebXR), sem instalar nada.
3 circuitos de água, 3 voltas, 5 lanchas rivais em 3 níveis, portais de boias (passar fora dá
+2 s), rampas flutuantes de salto e troncos/boias soltas no caminho. Física de água: a lancha
escorrega de lado na curva, acelera e freia devagar. Também joga no PC (teclado ou controle de
videogame). Tudo em português.

## Como rodar / jogar

**No Quest:** abrir no navegador do óculos **https://parappathe.github.io/LanchaVR/** (ou a página
inicial https://parappathe.github.io/) e apertar "Entrar em VR". Jogar sentado. Para atualizar o
site: commitar e rodar `python publicar.py LanchaVR` na pasta `C:\claude code`.

**No PC:** `python serve.py` nesta pasta e abrir `http://localhost:8784` (o painel de visualização
usa `.claude/launch.json`). `python serve.py --https` serve na rede de casa para testar no Quest
sem publicar.

### Controles

| | VR (Quest) | PC |
|---|---|---|
| Acelerar | Gatilho direito, ou empurrar a manete (segurar com o botão lateral) | Seta para cima / W (controle: RT ou A) |
| Reduzir / ré | Gatilho esquerdo, ou puxar a manete para trás | Seta para baixo / S (controle: LT) |
| Leme | Segurar o volante com o botão lateral (grip) de uma ou das duas mãos e girar; ou o analógico | Setas / A e D (controle: analógico) |
| Buzina | A ou X | H ou Espaço (controle: X) |
| Pausa | B ou Y | Esc ou P (controle: Start) |
| Câmera | Sempre na cabine | C troca entre atrás da lancha e cabine |
| FPS | Opções → Mostrar FPS | Tecla F |

A manete fica onde a mão soltou (como a de verdade); o gatilho soma com ela.

Conforto: no VR a cabeça fica presa ao assento e o horizonte nunca inclina (a lancha do jogador
não empina nem rola, nem no salto). "Balanço no VR" (ligado por padrão) só sobe e desce a
cabine no máximo 1,5 cm com as ondas; dá para desligar. "Conforto" (ligado por padrão) escurece
as bordas da visão nas curvas fortes, derrapagens e saltos. "Recentralizar" na pausa põe a
cabeça de volta no banco.

### Regras

6 lanchas, 3 voltas; o jogador larga em último. Em cada volta há 7 portais (boia vermelha à
direita, verde à esquerda); a seta amarela flutuando mostra o próximo. Passar fora do portal =
+2 s de penalidade (aparece no painel e no resultado). Classificação final = tempo de prova +
penalidades. Margens (barranco, paredão) seguram a lancha, com batida e perda de velocidade. A
faixa rasa perto da margem (juncos, aguapés) reduz a velocidade. Tronco ou boia solta: perde
metade da velocidade. Rampas flutuantes fazem saltar (quem entra pelo lado não sobe). Depois que
o jogador cruza a chegada, o computador pilota por ele e o resultado aparece (rivais que não
chegaram em 12 s têm o tempo estimado, marcado com ~).

Circuitos (em `js/tracks.js`): Rio Manso (1295 m, rio largo com mata, 1 rampa), Cânion (1023 m,
estreito entre paredões, curvas fechadas, 1 rampa), Pantanal ao Pôr do Sol (1323 m, lagoas e
aguapés, 2 rampas). Níveis (em `js/ai.js`): Fácil, Médio, Difícil. Melhor tempo final, melhor
volta e melhor colocação por circuito/nível ficam salvos no navegador (localStorage, chave
`lanchavr.v1`).

## Como testar

- `node tests/run.js` (ou `npm test`): canal não se cruza e não tem curva fechada demais,
  projeção, portais/obstáculos/rampas bem colocados, margem segura a lancha, andar de ré pela
  largada não conta volta, robô completa os 3 circuitos no tempo limite sem penalidade, salta nas
  rampas e desvia dos troncos, níveis em ordem, corrida de 6 termina com resultado de todos e
  penalidades somadas, física (acelera devagar, desliza de lado na curva, deriva some na reta,
  freia devagar, dá ré, quase não vira parada), portal perdido dá +2 s e passado não dá, e a
  calibragem dos níveis (robô vence quase sempre no Fácil e no Médio e briga no Difícil). Tem que
  terminar com "Tudo certo" (~15 s). Não toca som.
- No navegador (console): `lancha.startRace(0); lancha.dev.autoplay = true; lancha.dev.advance(10)`
  corre 10 s na hora com o robô pilotando. `advance` existe porque o painel de visualização
  escondido não anima a página (chamadas longas demais estouram o tempo da ferramenta: use
  pedaços de ~5 s). `lancha.renderer.info.render.calls` mostra o peso de desenho (~60 a 70 por
  olho, 40 a 56 mil triângulos).
- **Só dá para testar no óculos:** pegar e girar o volante, pegar a manete, gatilhos, conforto
  (deriva lateral e saltos), vibração, FPS real, altura do assento e posição da tela no painel.

## Estrutura

| Arquivo | O que tem |
|---|---|
| `index.html`, `css/style.css` | Página, botão "Entrar em VR", painel da lancha no canto (PC) |
| `js/track.js` | `Track`: curva do canal, projeção (s, lat), rampas, portais, obstáculos, linha ideal e perfil de velocidade. Sem navegador |
| `js/tracks.js` | Os 3 circuitos (pontos, largura, rampas, portais, obstáculos, cores e tipo de cenário). Sem navegador |
| `js/boat.js` | Física da lancha em passo fixo de 1/120 s (`PHYS` tem as constantes). Sem navegador |
| `js/ai.js` | Níveis (`LEVELS`), nomes/cores das rivais e o `Driver` que pilota. Sem navegador |
| `js/race.js` | `Race`: largada, voltas, portais e penalidades, obstáculos, batidas, resultado. Sem navegador |
| `js/waves.js` | Fórmula das ondas (a mesma do shader), para os barcos e boias balançarem. Sem navegador |
| `js/main.js` | Liga tudo: render, assento/VR, volante e manete, teclado/controle, menus, câmera, sons |
| `js/scene.js` | Céu, água (shader com ondas), margens de cada tema, vegetação, boias, troncos, rampas, pórtico, modelo da lancha, esteira de espuma, vinheta de conforto |
| `js/hud.js` | Painel da lancha (posição, volta, tempo, portal, penalidade, velocidade, minimapa) e letreiro grande |
| `js/ui.js` | Painel de menu 3D (mesmo dos outros jogos, cores próprias) |
| `js/audio.js` | Sons sintetizados (motor de popa, água, portal, penalidade, tronco, splash, buzina) |
| `js/save.js` | Recordes e opções salvos |
| `serve.py` | Servidor local sem cache (`--https` para testar no Quest pela rede de casa) |
| `tests/run.js` | Testes automáticos |
| `vendor/three/three.module.js` | Three.js r170 (cópia local) |

Convenções: metros; água em y = 0; `s` = distância ao longo do canal; `lat` = desvio lateral
(positivo = à esquerda); `h` = direção da lancha igual a `rotation.y` (olha para (-sen h, -cos h));
`steer` -1 esquerda, +1 direita; na lancha, `v` = velocidade para frente e `w` = deriva lateral
(positivo = para a esquerda), com a velocidade de verdade guardada no mundo (`vx`, `vz`).

## Regras e convenções do projeto

- `track.js`, `tracks.js`, `boat.js`, `ai.js`, `race.js`, `waves.js` e `util.js` não podem usar
  navegador nem Three.js: os testes rodam no Node.
- Mexeu em circuito, física ou pilotos: rodar `node tests/run.js`.
- Circuito novo: pontos espaçados ~30 a 80 m; rampas só em reta; portais longe de rampas;
  obstáculos fora da linha ideal e longe dos portais (o teste confere tudo isso).
- Dificuldade: `speed` (fração da velocidade possível), `wander` (quanto erra a linha), `gateErr`
  (erro de mira no portal) e `dodge` (chance de ver o tronco a tempo) em `LEVELS`; `aiPace` por
  circuito em `tracks.js`; `catchUp` em `race.js` aproxima o pelotão (±3%).
- Peso de desenho: água e margens são uma malha só cada; árvores, juncos, pedras, aguapés,
  boias e troncos são instâncias; peças paradas da lancha são juntadas com cor por vértice;
  esteira de todas as lanchas numa malha só. Sem sombras em tempo real.

## Decisões

- Feito a partir do KartVR (cópia do núcleo, sem dependência entre pastas).
- Ondas só no visual (shader + mesma fórmula em `waves.js`); a física considera a água plana,
  para a corrida ser previsível e os testes repetíveis.
- A malha da água só cobre o canal; as margens são faixas ao longo do canal que nunca invadem
  outro trecho. Rio: chão distante abaixo da água. Pantanal: em volta é lagoa (a mesma água, mais
  baixa). Cânion: planalto no alto, invisível de baixo.
- Deriva: o casco acompanha 60% do giro na hora; o resto vira velocidade lateral que some ~2/s.
  A IA mira usando a direção do movimento (não a da proa) e põe leme de antemão na curva.
- Batida entre lanchas: dois círculos por casco (proa e popa).
- Rivais ultrapassam escolhendo um lado e mantendo a escolha (sem ficar trocando); sem espaço,
  seguem atrás sem bater; perto de portal só ultrapassam por dentro dele.
- Jogador larga em último; níveis calibrados para o robô (que pilota perfeito) ganhar quase
  sempre no Fácil e no Médio e brigar no Difícil. No Cânion os rivais andam 3% menos (`aiPace`)
  porque quase não dá para ultrapassar no canal estreito.

## Pendências / problemas conhecidos

- Nada testado no Quest ainda: alcance e sensibilidade do volante (giro máximo ~90°), pegar a
  manete, altura do assento e posição da tela no painel, conforto da deriva e dos saltos, FPS.
- A margem física é a borda do canal; nas curvas fechadas a proa (5 m de lancha) pode encostar
  visualmente no barranco antes de a batida acontecer.
