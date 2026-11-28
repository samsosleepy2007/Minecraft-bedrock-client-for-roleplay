# SleepyArmor Lite

โดย **SamSoSleepy** (ร้าน SleepyShop) — open source ภายใต้ GPL-3.0 ใช้ฟรีทุกคน

🌐 **เว็บ:** https://samsosleepy2007.github.io/Minecraft-bedrock-client-for-roleplay/

เว็บนี้สร้าง Resource Pack (`.mcpack`) ที่ช่วยลดภาระการเรนเดอร์เกราะแอดออน (custom armor attachables) ใน Minecraft Bedrock ตามระยะห่างจากกล้อง:
ลดความละเอียด texture / ลด cube / ปิดฟิสิกส์ / ซ่อนเกราะเมื่ออยู่ไกล
**ไม่แก้ตัวเกม** และ **ไม่อัปโหลดไฟล์ใด ๆ** — ทุกอย่างประมวลผลในเบราว์เซอร์ของคุณ

## วิธีใช้
1. เปิดเว็บ → เลือกไฟล์แอดออนเกราะ (`.mcaddon` / `.mcpack` / `.zip`) ได้หลายไฟล์
2. ติ๊กเกราะที่ต้องการ (ถ้ามีชื่อซ้ำข้ามแอดออน ให้เลือกอันเดียว)
3. เลือก preset (ประหยัดสุด / สมดุล / สวยสุด) หรือปรับเอง — ปรับแยกรายชุดได้
4. กด **สร้าง pack** → ดาวน์โหลด `SleepyArmorLite.mcpack`
5. Import เข้าเกม
   - **Android:** แตะไฟล์ที่ดาวน์โหลด → เปิดด้วย Minecraft
   - **iOS:** กด "ส่งเข้า Minecraft" → เลือก Minecraft (หรือแอป Files → Share → Minecraft)
6. วาง pack ให้อยู่ **เหนือ** แอดออนเกราะ ในที่เดียวกับที่แอดออนติดตั้งอยู่:
   - แอดออนอยู่ใน **Global Resources** → เปิด SleepyArmor Lite ใน Global Resources แล้ววางไว้เหนือแอดออน
   - แอดออนอยู่ใน **โลก** (Resource Packs ของโลก) → pack ของโลกจะทับ Global Resources ต้องแก้ไขโลก → Resource Packs → เพิ่ม SleepyArmor Lite ไว้เหนือแอดออน
   - **เซิร์ฟเวอร์** ที่ส่งแอดออนให้อัตโนมัติ → pack ของเซิร์ฟอยู่เหนือ pack ในเครื่อง จึงอาจไม่มีผล ต้องให้เจ้าของเซิร์ฟใส่ pack นี้
   - pack นี้มีโมเดล/texture/animation ต้นฉบับในตัว จึงไม่ขึ้น `geometry not found` แม้แอดออนต้นฉบับอยู่คนละที่

สร้างใหม่ซ้ำได้ — pack จะเป็นเวอร์ชันใหม่ของ pack เดิม (UUID เดิม, version เพิ่มขึ้น)

## ทดสอบด้วยโหมด DEBUG (สำคัญ)
ยังต้องยืนยันในเกมจริงว่า `q.distance_from_camera` ใช้ใน attachable ได้
1. ติ๊ก **โหมด DEBUG** → สร้าง → ได้ `SleepyArmorLite_DEBUG.mcpack`
2. ใส่เกราะให้ Armor Stand (หรือเพื่อน) แล้วเดินออกห่าง
3. เกราะควรเปลี่ยนสีตามขั้น: ขั้น 1 ฟ้า → ขั้น 2 แดง → ขั้น 3 เขียว → ขั้น 4 เหลือง → หายไป (ถ้าเปิดซ่อน)
4. ถ้าสีไม่เปลี่ยนเลย = ระบบระยะไม่ทำงานในเวอร์ชันเกมนั้น — แจ้งได้ที่ Issues
5. ทดสอบเสร็จ ปิด DEBUG แล้วสร้างใหม่เพื่อใช้งานจริง

## เปิด GitHub Pages (ทำครั้งเดียว ทำบนมือถือได้)
1. เปิด repo ใน browser มือถือ (ถ้าแอป GitHub ไม่มีเมนูนี้ ให้กด "Desktop site" ในเมนู browser)
2. **Settings** → **Pages**
3. ช่อง **Source** เลือก **GitHub Actions**
4. ทุกครั้งที่ push ไป `main` ระบบจะรัน test → build → deploy อัตโนมัติ (ถ้า test ไม่ผ่านจะไม่ deploy)
5. ดูสถานะได้ที่แท็บ **Actions** — เสร็จแล้วเว็บอยู่ที่ลิงก์ด้านบน

## สำหรับนักพัฒนา
```bash
npm ci
npm test      # unit tests (Vitest)
npm run dev   # dev server
npm run build # -> dist/
npm run pages # build + copy to repo root (index.html, assets/) — run before every push
```
- `web/index.html` ซอร์สหน้าเว็บ · `index.html` + `assets/` ที่ root = เว็บที่ build แล้ว (ใช้ได้ทั้ง Source แบบ GitHub Actions และ Deploy from branch)
- `src/core/` ตัวประมวลผล pack (scanner, molang, geometry, texture, builder, settings)
- `src/worker.js` ประมวลผลใน Web Worker · `src/main.js` UI · `test/` unit test + fixture เกราะตัวอย่าง

## License
Copyright (C) 2026 SamSoSleepy — [GPL-3.0](LICENSE) ดู [NOTICE.txt](NOTICE.txt)
แก้ไข/แจกต่อได้ แต่ต้องเปิดซอร์สภายใต้ GPL-3.0 และคงชื่อผู้สร้างไว้
