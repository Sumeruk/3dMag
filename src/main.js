import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const heatColors = ['#31b65a', '#c9b43b', '#d8742f', '#d83232']
const flowColors = ['#43c66a', '#cc9a31', '#cf4d42']

const blocks = [
  { name: 'Блок 3', suffix: '3', x: -8.2, load: 0.74 },
  { name: 'Блок 2', suffix: '2', x: 0, load: 0.59 },
  { name: 'Блок 1', suffix: '1', x: 8.2, load: 0.83 },
]

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="warehouse-app">
    <header class="topbar">
      <div>
        <p class="eyebrow">Логистический центр</p>
        <h1>Воронеж 2</h1>
      </div>
      <div class="status-strip" aria-label="Сводка склада">
        <span><b id="active-flow">18</b> посылок в пути</span>
        <span><b>91%</b> SLA отгрузки</span>
        <span><b>+24%</b> поток к 14:00</span>
      </div>
    </header>

    <section class="workspace">
      <aside class="side-panel">
        <div class="panel-section">
          <p class="panel-label">Режим карты</p>
          <div class="segmented" role="group" aria-label="Режим отображения">
            <button class="mode-button is-active" type="button" data-mode="heat">Тепло</button>
            <button class="mode-button" type="button" data-mode="flow">Потоки</button>
          </div>
        </div>

        <div class="panel-section">
          <p class="panel-label">Нагрузка блоков</p>
          <div class="load-list">
            ${blocks.map((block) => `
              <button class="block-jump" type="button" data-block="${block.suffix}">
                <span>${block.name}</span>
                <meter min="0" max="1" value="${block.load}"></meter>
                <b>${Math.round(block.load * 100)}%</b>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="panel-section">
          <p class="panel-label">Тепловая шкала</p>
          <div class="legend">
            <span style="--color:#31b65a">Низко</span>
            <span style="--color:#c9b43b">Средне</span>
            <span style="--color:#d8742f">Высоко</span>
            <span style="--color:#d83232">Пик</span>
          </div>
        </div>
      </aside>

      <section class="map-shell" aria-label="Интерактивная карта склада">
        <div id="scene"></div>
        <div class="map-caption">
          <span>Клик по ячейке показывает остатки, температуру спроса и маршрут пополнения.</span>
          <span>Колесо мыши масштабирует карту, перетаскивание меняет ракурс.</span>
        </div>
      </section>

      <aside class="detail-panel" aria-live="polite">
        <p class="panel-label">Выбранный объект</p>
        <h2 id="detail-title">Ячейка A1</h2>
        <p id="detail-description">Высокая активность отбора: товары часто уходят в зону загрузки.</p>
        <dl class="detail-grid">
          <div>
            <dt>SKU</dt>
            <dd id="detail-sku">246</dd>
          </div>
          <div>
            <dt>Заполнено</dt>
            <dd id="detail-stock">82%</dd>
          </div>
          <div>
            <dt>Спрос</dt>
            <dd id="detail-heat">Пик</dd>
          </div>
          <div>
            <dt>Маршрут</dt>
            <dd id="detail-route">Погрузка 4 мин</dd>
          </div>
        </dl>
      </aside>
    </section>
  </main>
`

const sceneHost = document.querySelector('#scene')
const detailTitle = document.querySelector('#detail-title')
const detailDescription = document.querySelector('#detail-description')
const detailSku = document.querySelector('#detail-sku')
const detailStock = document.querySelector('#detail-stock')
const detailHeat = document.querySelector('#detail-heat')
const detailRoute = document.querySelector('#detail-route')

const scene = new THREE.Scene()
scene.background = new THREE.Color('#f1f3f0')

const camera = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 100)
camera.position.set(0, 16, 14)
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
sceneHost.appendChild(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.46
controls.minPolarAngle = Math.PI * 0.22
controls.minZoom = 0.75
controls.maxZoom = 2.1
controls.target.set(0, 0, 0.6)

const hemiLight = new THREE.HemisphereLight('#ffffff', '#b9c0bd', 2.6)
scene.add(hemiLight)

const sun = new THREE.DirectionalLight('#ffffff', 2.4)
sun.position.set(-8, 12, 8)
sun.castShadow = true
scene.add(sun)

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(27.5, 16),
  new THREE.MeshStandardMaterial({ color: '#dfe3df', roughness: 0.88 })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const interactive = []
const packages = []
let selectedObject
let hoveredObject
let currentMode = 'heat'

function colorForHeat(value) {
  if (value < 0.35) return heatColors[0]
  if (value < 0.62) return heatColors[1]
  if (value < 0.82) return heatColors[2]
  return heatColors[3]
}

function heatLabel(value) {
  if (value < 0.35) return 'Низкий'
  if (value < 0.62) return 'Средний'
  if (value < 0.82) return 'Высокий'
  return 'Пик'
}

function seededHeat(blockIndex, columnIndex, rowIndex) {
  const raw = Math.sin((blockIndex + 1) * 1.8 + columnIndex * 0.74 + rowIndex * 1.17)
  const shaped = (raw + 1) / 2
  return Math.min(0.96, Math.max(0.18, shaped * 0.78 + (columnIndex > 3 ? 0.16 : 0)))
}

function makeBox(width, height, depth, color, opacity = 1) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.02,
      transparent: opacity < 1,
      opacity,
    })
  )
}

function makeLabel(text, size = 0.62, color = '#17212a') {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = 512
  canvas.height = 160
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = '700 58px Segoe UI, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(size * 3.2, size, 1)
  return sprite
}

function addFrame(group, width, depth, color = '#416b82') {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.65 })
  const parts = [
    [width, 0.16, 0.12, 0, 0.08, -depth / 2],
    [width, 0.16, 0.12, 0, 0.08, depth / 2],
    [0.12, 0.16, depth, -width / 2, 0.08, 0],
    [0.12, 0.16, depth, width / 2, 0.08, 0],
  ]

  parts.forEach(([w, h, d, x, y, z]) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    rail.position.set(x, y, z)
    rail.receiveShadow = true
    group.add(rail)
  })
}

function makePath(points, color, width = 0.045) {
  const curve = new THREE.CatmullRomCurve3(points)
  const geometry = new THREE.TubeGeometry(curve, 80, width, 8, false)
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.18,
    roughness: 0.4,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.curve = curve
  scene.add(mesh)
  return { curve, mesh }
}

function addZone({ name, type, x, z, width, color }) {
  const zone = makeBox(width, 0.18, 1.32, color, 0.78)
  zone.position.set(x, 0.1, z)
  zone.userData = {
    kind: 'zone',
    name,
    description: type === 'load'
      ? 'Финальная точка маршрутов перед отправкой транспорта.'
      : 'Входящий поток паллет и посылок для раскладки по ячейкам.',
    sku: type === 'load' ? '1 120' : '780',
    stock: type === 'load' ? '12 ворот' : '8 ворот',
    heat: type === 'load' ? 'Высокий' : 'Средний',
    route: type === 'load' ? 'Отбор 4-9 мин' : 'Разнос 6-12 мин',
  }
  zone.castShadow = true
  zone.receiveShadow = true
  interactive.push(zone)
  scene.add(zone)

  const label = makeLabel(name, 0.58, '#111827')
  label.position.set(x, 0.72, z + 0.02)
  scene.add(label)
}

function buildBlock(block, blockIndex) {
  const group = new THREE.Group()
  group.position.x = block.x
  scene.add(group)

  const base = makeBox(6.2, 0.08, 8.3, '#c4cac8', 0.9)
  base.position.y = 0.02
  base.receiveShadow = true
  group.add(base)
  addFrame(group, 6.3, 8.4)

  const title = makeLabel(block.name, 0.62, '#111827')
  title.position.set(0, 0.55, -4.75)
  group.add(title)

  columns.forEach((column, columnIndex) => {
    for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
      const heat = seededHeat(blockIndex, columnIndex, rowIndex)
      const stock = Math.round(45 + heat * 49 - rowIndex * 6)
      const height = 0.18 + heat * 0.72
      const cell = makeBox(0.68, height, 2.15, colorForHeat(heat), 0.94)
      cell.position.set(-2.55 + columnIndex * 0.85, height / 2 + 0.06, -2.15 + rowIndex * 1.08)
      cell.castShadow = true
      cell.receiveShadow = true
      cell.userData = {
        kind: 'cell',
        id: `${column}${block.suffix}-${rowIndex + 1}`,
        display: `${column}${block.suffix}`,
        block: block.name,
        heat,
        sku: Math.round(120 + heat * 185 + columnIndex * 11),
        stock,
        route: heat > 0.76 ? 'Погрузка 4 мин' : 'Пополнение 7 мин',
        baseColor: colorForHeat(heat),
      }
      interactive.push(cell)
      group.add(cell)

      if (rowIndex === 0) {
        const label = makeLabel(`${column}${block.suffix}`, 0.28, '#1f2933')
        label.position.set(cell.position.x, 0.68, -3.57)
        group.add(label)
      }
    }
  })

  const aisleMaterial = new THREE.MeshStandardMaterial({ color: '#486f83', roughness: 0.68 })
  ;[-0.25, 1.1, 2.25].forEach((z, row) => {
    const left = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.06, 0.07), aisleMaterial)
    left.position.set(-1.6, 0.13, z)
    const right = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.06, 0.07), aisleMaterial)
    right.position.set(1.6, 0.13, z)
    group.add(left, right)

    const pathColor = flowColors[(blockIndex + row) % flowColors.length]
    makePath([
      new THREE.Vector3(block.x - 2.25, 0.2, z - 0.3),
      new THREE.Vector3(block.x - 1.2, 0.2, z - 0.15),
      new THREE.Vector3(block.x + 1.2, 0.2, z - 0.15),
      new THREE.Vector3(block.x + 2.25, 0.2, z - 0.3),
    ], pathColor, 0.026)
  })
}

blocks.forEach(buildBlock)

addZone({ name: 'Зона разгрузки', type: 'unload', x: -5.6, z: 6.15, width: 6.7, color: '#98a1a6' })
addZone({ name: 'Зона загрузки', type: 'load', x: 5.6, z: 6.15, width: 6.7, color: '#b8aa7b' })

const mainRoutes = [
  { color: '#c07c34', points: [[-5.7, 6.0], [-6.9, 4.4], [-8.1, 2.4], [-8.1, 0.8]] },
  { color: '#42c56a', points: [[-5.2, 6.0], [-4.2, 4.9], [-1.1, 3.8], [0, 2.4], [0, 0.5]] },
  { color: '#cf493f', points: [[-4.7, 6.0], [-2.6, 5.1], [2.7, 4.1], [8.2, 2.0], [8.2, 0.4]] },
  { color: '#b98626', points: [[7.2, 6.0], [7.8, 4.5], [8.2, 2.3], [8.2, 0.0]] },
  { color: '#47c963', points: [[5.4, 6.0], [4.7, 4.8], [2.2, 3.7], [0, 2.2], [0, 0.2]] },
  { color: '#d97130', points: [[4.8, 6.0], [2.2, 4.9], [-3.3, 3.9], [-8.2, 2.0], [-8.2, 0.3]] },
]

const routeMeshes = mainRoutes.map((route) => makePath(
  route.points.map(([x, z]) => new THREE.Vector3(x, 0.2, z)),
  route.color,
  0.035
))

routeMeshes.forEach(({ curve }, index) => {
  for (let i = 0; i < 3; i += 1) {
    const cargo = makeBox(0.24, 0.24, 0.32, index % 2 ? '#2f8fb0' : '#e0a33a')
    cargo.userData = {
      curve,
      offset: (i * 0.29 + index * 0.11) % 1,
      speed: 0.025 + (index % 3) * 0.006,
    }
    cargo.castShadow = true
    packages.push(cargo)
    scene.add(cargo)
  }
})

function updateDetails(data) {
  if (data.kind === 'cell') {
    detailTitle.textContent = `${data.block} / ${data.display}`
    detailDescription.textContent = data.heat > 0.76
      ? 'Горячая ячейка: частый отбор, нужен короткий маршрут к зоне загрузки.'
      : 'Стабильная ячейка хранения с плановым пополнением по внутреннему маршруту.'
    detailSku.textContent = data.sku
    detailStock.textContent = `${data.stock}%`
    detailHeat.textContent = heatLabel(data.heat)
    detailRoute.textContent = data.route
    return
  }

  detailTitle.textContent = data.name
  detailDescription.textContent = data.description
  detailSku.textContent = data.sku
  detailStock.textContent = data.stock
  detailHeat.textContent = data.heat
  detailRoute.textContent = data.route
}

function setSelected(object) {
  if (selectedObject && selectedObject !== object) {
    selectedObject.scale.set(1, 1, 1)
  }
  selectedObject = object
  selectedObject.scale.set(1.05, 1.16, 1.05)
  updateDetails(object.userData)
}

function resetHover() {
  if (!hoveredObject || hoveredObject === selectedObject) return
  hoveredObject.scale.set(1, 1, 1)
}

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const [hit] = raycaster.intersectObjects(interactive, false)
  resetHover()
  hoveredObject = hit?.object
  sceneHost.classList.toggle('is-pointing', Boolean(hoveredObject))
  if (hoveredObject && hoveredObject !== selectedObject) {
    hoveredObject.scale.set(1.04, 1.08, 1.04)
  }
}

function onClick() {
  if (hoveredObject) setSelected(hoveredObject)
}

function resize() {
  const { clientWidth, clientHeight } = sceneHost
  renderer.setSize(clientWidth, clientHeight)
  const aspect = clientWidth / clientHeight
  camera.left = -10.8 * aspect
  camera.right = 10.8 * aspect
  camera.top = 8.2
  camera.bottom = -8.2
  camera.updateProjectionMatrix()
}

function setMode(mode) {
  currentMode = mode
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode)
  })

  routeMeshes.forEach(({ mesh }) => {
    mesh.material.opacity = mode === 'flow' ? 1 : 0.58
    mesh.material.transparent = mode !== 'flow'
  })

  interactive.forEach((object) => {
    if (object.userData.kind !== 'cell') return
    object.material.emissive = new THREE.Color(object.userData.baseColor)
    object.material.emissiveIntensity = mode === 'heat' ? 0.12 : 0.03
  })
}

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode))
})

document.querySelectorAll('.block-jump').forEach((button) => {
  button.addEventListener('click', () => {
    const block = blocks.find((item) => item.suffix === button.dataset.block)
    if (!block) return
    controls.target.set(block.x, 0, 0.6)
  })
})

renderer.domElement.addEventListener('pointermove', onPointerMove)
renderer.domElement.addEventListener('click', onClick)
window.addEventListener('resize', resize)

setSelected(interactive.find((object) => object.userData.display === 'A1'))
setMode(currentMode)
resize()

const clock = new THREE.Clock()

function animate() {
  const elapsed = clock.getElapsedTime()
  packages.forEach((cargo) => {
    const progress = (elapsed * cargo.userData.speed + cargo.userData.offset) % 1
    const point = cargo.userData.curve.getPointAt(progress)
    const next = cargo.userData.curve.getPointAt((progress + 0.01) % 1)
    cargo.position.copy(point)
    cargo.position.y = 0.43 + Math.sin(elapsed * 5 + cargo.userData.offset * 10) * 0.025
    cargo.lookAt(next.x, cargo.position.y, next.z)
    cargo.visible = currentMode === 'flow' || progress > 0.18
  })

  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}

animate()
