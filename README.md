# Room Atmosphere 2D

把一張**平光的 2D 像素房間**，靠一份很輕量的 **2.5D 代理幾何**（窗戶開口、牆地平面、家具方盒），即時加上直射光與陰影、光束、浮塵、流動霧、柔焦、膠片顆粒、色散，並能切換日夜。

靈感來自 [@vux429 的 Godot 橫捲貼文](https://www.threads.com/@vux429/post/De7EVP5GFse)。這裡用 WebGL2 + Canvas2D 重現同樣的思路，不用任何 3D 網格。

技術拆解見 [docs/technique.md](docs/technique.md)。

## 執行

```bash
npm install
npm run dev
```

開啟 http://localhost:5180

## 操作

| 按鍵 / UI | 功能 |
| --- | --- |
| `1` `2` `3` | 原始 / 柔光調色 / 電影氣氛 |
| `D` / `N` | 日間 09:00 / 夜間 01:30 |
| `P` | 暫停動態空氣 |
| `G` | 顯示幾何資料；可拖曳黃色的「直射光落點」、點選拖曳家具、滾輪抬高 |
| `B` / `Delete` | 新增方塊 / 刪除選取的家具 |
| 檢視 | 合成 / 原圖 / 深度 / 法線 / 直射光 |

## AI 重繪原圖

`art/ai-albedo.png` 是把平光原圖 `art/flat-source.png` 交給 Atlas Cloud 的 `google/nano-banana-pro/edit` 重繪的結果：構圖不變、維持平光，光影仍然完全由代理幾何即時計算。面板上的「AI 原圖」可以切換回平光版本比較。

重新產生（每張約 US$0.14）：

```bash
node scripts/ai-repaint.mjs
```

API 金鑰從 macOS 鑰匙圈讀取（service 名稱 `atlascloud-api-key`），不會寫進任何檔案。第一次使用先存入：

```bash
security add-generic-password -U -a "$USER" -s atlascloud-api-key -w
```

限制：開啟 AI 原圖時，移動「原有」家具只會移動光影代理，畫面上的家具仍留在原位；新增的方塊會直接畫在 AI 原圖上。

## 結構

```
src/
  config.ts            所有可調參數：相機、渲染、時間關鍵影格、preset、UI 定義
  scene/roomData.ts    房間的調色盤 + 代理幾何
  scene/layers.ts      把代理幾何畫成 albedo / depth / normal / emissive 四張 Canvas
  scene/editing.ts     即時編輯代理幾何（選取、移動、抬高、新增、刪除）
  camera.ts            單點透視投影（shader 端的反投影與它對稱）
  lighting.ts          時間 → 光的狀態；CPU 版能見度測試（浮塵、落點）
  dust.ts              浮塵粒子
  render/renderer.ts   WebGL2 pass 串接
  render/shaders/      lighting（延遲光照 + 光束）、blur、final（後製）
  overlay.ts           幾何資料疊圖與落點拖曳
  ui.ts                從 config 定義產生控制面板與快捷鍵
scripts/ai-repaint.mjs 用 Atlas Cloud 重繪原圖
art/                 平光原圖與 AI 重繪結果
```
