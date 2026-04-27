# ใช้ Node 20 ตัวเต็ม
FROM node:20

# บอกให้ Docker สร้างและเข้าไปทำงานในโฟลเดอร์ /app "ข้างในกล่อง"
WORKDIR /app

# ก๊อปปี้ package.json จากเครื่องเรา เข้าไปในกล่อง แล้วติดตั้ง dependencies
COPY package.json ./
RUN npm install

# ก๊อปปี้โค้ดที่เหลือทั้งหมด (รวมถึง server.js, โฟลเดอร์ config/ ฯลฯ) เข้าไปในกล่อง
COPY . .

# เปิดพอร์ต 5000
EXPOSE 5000

# สั่งให้กล่องรันไฟล์ server.js ตอนที่เปิดใช้งาน
CMD ["node", "server.js"]