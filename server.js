const express = require('express')
const cors = require('cors')
const http = require('http')
const app = express()
const {Server} = require('socket.io')
const dotenv = require('dotenv')
const {Readable} = require('stream')
const fs = require("fs");
const path = require("path")

const server = http.createServer(app)

dotenv.config()

app.use(cors)

const io = new Server(server, {
    cors: {
        origin: process.env.ELECTRON_HOST,
        methods: ['GET', 'POST']
    }
})


io.on('connection', (socket) => {
    let recordedChunks = [];
    console.log('🟢 Socket is connected')

    socket.on('video-chunks', async (data) =>  {
        console.log('🟢 Video chunk is sent')
        const filePath = path.join('temp_upload', data.filename); 
        const writeStream = fs.createWriteStream(filePath)
        recordedChunks.push(data.chunks)

        const videoBlob = new Blob(recordedChunks, {
            type: 'video/webm; codecs=vp9'
        })

        const buffer = Buffer.from(await videoBlob.arrayBuffer())

        const readStream = Readable.from(buffer).on('finish', () => {
            console.log('🟢 Chunk saved ')

        })
        readStream.pipe(writeStream)
    })

    socket.on('process-video', async (data) =>  {
        console.log('🟢 Processing video ', data)
    })

    socket.on('disconnect', async (data) =>  {
        console.log('🟢 Socket.id is disconnected ', socket.id)
    })
})

server.listen(5001,() => {
    console.log('🟢 Listening on port 5001')
})