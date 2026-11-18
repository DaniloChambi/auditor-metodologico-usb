FROM node:22-alpine

WORKDIR /app

COPY package.json server.js evaluate.php index.html styles.css app.js logousb_blue.png guia-orientadora-talleres-grado-paneles.pdf ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
