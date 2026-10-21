# PON Cut — เว็บตัดต่อวิดีโอบนเครื่อง

เว็บอินเทอร์เฟซสำหรับ engine ของ [Concat](https://github.com/jub0t/Concat) ใน [fork นี้](https://github.com/pangpond1990/Concat/tree/feat/web-editor) เป็นโครงการแยกจากผู้พัฒนา Concat ต้นฉบับ ใช้สัญญาอนุญาต AGPL-3.0-or-later ตาม [LICENSE](../LICENSE)

## เปิดใช้งานบน Mac

ต้องมี **Node.js 22 ขึ้นไป** ดับเบิลคลิก **Start PON Cut.command** ที่โฟลเดอร์หลัก ตัวเปิดจะเตรียม engine และเปิด `http://127.0.0.1:4317` ให้ เก็บหน้าต่าง Terminal ไว้ขณะใช้งาน กด Ctrl+C เพื่อหยุด

หรือใช้ Terminal:

```sh
cd web
npm run setup
npm start
```

ไม่ต้อง `npm install` — เว็บไม่มี runtime npm dependencies สคริปต์ setup ดาวน์โหลด Concat 0.2.8 จาก official GitHub release ตรวจ SHA-256 ที่ pin ไว้ แล้วเก็บแอปไว้ใน `vendor/Concat.app` ภายใน repo ไม่ติดตั้งทับแอปใน `/Applications` รองรับ setup อัตโนมัติบน Mac ARM64 และ Intel

หากมี engine อยู่แล้ว:

```sh
CONCAT_BINARY="/Applications/Concat.app/Contents/MacOS/concat" npm start
```

บน Linux/Windows ให้ติดตั้ง official Concat หรือ build `cargo build --profile app -p concat` ใน `src/` แล้วตั้ง `CONCAT_BINARY` เป็นไฟล์ executable ที่รองรับ `--mcp headless` เว็บใช้ Node และ API เดียวกัน แต่การทดสอบ end-to-end ในงานนี้ทำบน macOS ARM64 กับ Concat 0.2.8 เท่านั้น

## วิธีตัดต่อ

1. **สร้างโปรเจกต์** เลือก 9:16, 16:9 หรือ 1:1 และเฟรมเรต
2. **นำเข้าไฟล์** หรือวางไฟล์ลง Media แล้วกด **＋** บนไฟล์เพื่อเพิ่มท้ายไทม์ไลน์
3. คลิกคลิปเพื่อเลือก ลากเพื่อย้ายตำแหน่ง/แทร็ก ลากขอบซ้ายหรือขวาเพื่อตัด กด **S** แบ่งตรง playhead หรือกด **Delete/Backspace** เพื่อลบ เปิด Ripple เพื่อเลื่อนคลิปถัดไปตามการตัด
4. ปรับความยาว ความเร็ว เสียง ขนาด การหมุน ตำแหน่ง ความทึบ หรือ Fit/Fill ใน Inspector แล้วกด **ใช้การปรับแต่ง**
5. กด **T ข้อความ** เพิ่มชื่อเรื่องที่ playhead; เลือกข้อความบนไทม์ไลน์เพื่อเปลี่ยนคำ ขนาด สี และตำแหน่ง
6. คลิกแถบเวลาเพื่อดูภาพที่ engine เรนเดอร์ กด **▶** เพื่อเตรียมพรีวิว MP4 พร้อมเสียงครั้งแรก หลังแก้ไขจะต้องเตรียมพรีวิวใหม่
7. กด **ส่งออกวิดีโอ** รอ engine เรนเดอร์ แล้วกด **ดาวน์โหลด MP4**

ทุก edit บันทึกอัตโนมัติ กด ⌘/Ctrl+Z เพื่อ Undo, ⌘/Ctrl+Shift+Z เพื่อ Redo และ ⌘/Ctrl+S เพื่อบันทึกเอง โครงการเปิดกลับมาได้จากหน้าโปรเจกต์ ประวัติ Undo อยู่ใน engine session และไม่คงอยู่หลังปิดเซิร์ฟเวอร์

## ข้อมูลและขอบเขต

- เว็บเปิดเฉพาะ loopback `127.0.0.1` เครื่องนี้ ไม่มีการส่งไฟล์ไปคลาวด์
- `web/data/<project-id>/` เก็บเอกสาร Concat, `uploads/` เก็บสำเนาไฟล์นำเข้า, `exports/` เก็บวิดีโอส่งออกและพรีวิว สำรอง **ทั้งโฟลเดอร์ data** รวม media
- ไม่แก้ไฟล์ต้นฉบับที่นำเข้า ไฟล์ใหญ่ stream ลงดิสก์ จำกัด 10 GiB ต่อไฟล์ ต้องมีพื้นที่ว่างสำหรับสำเนาและผลลัพธ์
- พรีวิว MP4 และ exports เก็บไว้จนกว่าจะลบด้วยตัวเองขณะหยุดเซิร์ฟเวอร์ โครงการยังอ้างอิงไฟล์ใน uploads จึงไม่ควรลบ uploads แยกจากโครงการ
- เปลี่ยนพอร์ตด้วย `PORT=4318 npm start`; เปลี่ยนพื้นที่จัดเก็บด้วย `PON_CUT_DATA_DIR=/absolute/folder npm start`
- พรีวิวเป็นการเรนเดอร์จริง ไม่ใช่ playback สดแบบ GPU ของแอปเดสก์ท็อป การเตรียมพรีวิวคลิปยาวอาจใช้เวลา มี progress และปุ่มยกเลิก
- เวอร์ชันนี้มีเครื่องมือพื้นฐานตามรายการด้านบน ยังไม่มี UI สำหรับ auto-captions, AI cutout, voice cloning, effects catalogue, keyframe curves หรือฟีเจอร์เดสก์ท็อปทั้งหมด
- ไม่ออกแบบสำหรับ public hosting หรือหลายผู้ใช้พร้อมกัน
- Engine คงรูปแบบโปรเจกต์เดิม เว็บจัดการโฟลเดอร์ด้วย UUID และเปิดโครงการที่สร้างผ่านเว็บเท่านั้นในเวอร์ชันนี้

## ทดสอบ

ต้องมี `ffmpeg` และ `ffprobe` ใน PATH สำหรับสร้างและตรวจไฟล์ทดสอบ และ engine ที่ setup แล้ว:

```sh
cd web
npm test
```

ชุดทดสอบเรียก native engine จริง: create/import/split/undo/trim/title/save/reopen, PNG preview, MP4 H.264 พร้อม audio, ระยะเวลา, byte-range downloads, ปฏิเสธคำสั่ง filesystem, origin/Host ที่ไม่ถูกต้อง และเก็บกวาดไฟล์ upload ที่เสีย ส่วน Rust เดิมไม่ได้แก้ไข
