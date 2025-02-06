const express = require("express");
const cors = require("cors");
const http = require("http");
const app = express();
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const { Readable } = require("stream");
const fs = require("fs");
const path = require("path");
const { default: axios } = require("axios");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { default: OpenAI } = require("openai");

const server = http.createServer(app);

dotenv.config();

const port = process.env.PORT || 5001;

const openai = new OpenAI({
	apiKey: process.env.OPENAI_KEY,
});

const s3 = new S3Client({
	credentials: {
		accessKeyId: process.env.ACCESS_KEY,
		secretAccessKey: process.env.SECRET_KEY,
	},
	region: process.env.BUCKET_REGION,
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const videoRoutes = require("./routes/video-routes");

app.use("/api/videos", videoRoutes);

const io = new Server(server, {
	cors: {
		origin: process.env.ELECTRON_HOST,
		methods: ["GET", "POST"],
	},
});

io.on("connection", (socket) => {
	let recordedChunks = [];
	console.log("🟢 Socket is connected");

	socket.on("video-chunks", async (data) => {
		console.log("🟢 Video chunk is sent");
		const filePath = path.join("temp_upload", data.filename);
		const writeStream = fs.createWriteStream(filePath);
		recordedChunks.push(data.chunks);

		const videoBlob = new Blob(recordedChunks, {
			type: "video/webm; codecs=vp9",
		});

		const buffer = Buffer.from(await videoBlob.arrayBuffer());

		const readStream = Readable.from(buffer).on("finish", () => {
			console.log("🟢 Chunk saved ");
		});
		readStream.pipe(writeStream);
	});

	socket.on("process-video", async (data) => {
		try {
			console.log("🟢 Processing video ", data);

			recordedChunks = [];
			fs.readFile("temp_upload/" + data.filename, async (err, file) => {
                console.log('Got video: ', file)
                if(err) {
                    console.log('Error reading video file')
                    console.log(err)
                    return;
                }
				const processing = await axios.post(
					`${process.env.NEXT_API_HOST}/recording/${data.userId}/processing`,
					{ filename: data.filename }
				);

				if (processing.data.status !== 200) {
					return console.log(
						"Error, something went wrong while processing file"
					);
				}

				const Key = data.filename;
				const Bucket = process.env.BUCKET_NAME;
				const ContentType = "video/webm";
				const command = new PutObjectCommand({
					Key,
					Bucket,
					ContentType,
					Body: file,
				});

                // console.log('uploaded to aws ', {
				// 	Key,
				// 	Bucket,
				// 	ContentType,
				// 	Body: file,
				// })

				const fileStatus = await s3.send(command);

				// console.log(fileStatus);

				if (fileStatus?.["$metadata"]?.httpStatusCode === 200) {
					console.log("🟢 Successfully uploaded video to AWS");

					if (processing.data.plan === "PRO") {
						fs.stat(
							"temp_upload/" + data.filename,
							async (err, stat) => {
								if (!err) {
									// whisper 25mb
									if (stat.size < 25000000) {
										const transcription =
											await openai.audio.transcriptions.create(
												{
													file: fs.createReadStream(
														`temp_upload/${data.filename}`
													),
													model: "whisper-1",
													response_format: "text",
												}
											);

										if (transcription) {
											const completion =
												await openai.chat.completions.create(
													{
														model: "gpt-3.5-turbo",
														response_format: {
															type: "json_object",
														},
														messages: [
															{
																role: "system",
																content: `You are going to generate a title and a nice description using the speech to text transcription
                                                provided: transcription(${transcription}) and then return it in json format as {"title": <the title you gave>, "summary": <the summary you created>}`,
															},
														],
													}
												);

											const titleAndSummaryGenerated =
												await axios.post(
													`${process.env.NEXT_API_HOST}recording/${data.userId}/transcribe`,
													{
														filename: data.filename,
														content:
															completion
																.choices[0]
																.message
																.content,
														transcript:
															transcription,
													}
												);

											if (
												titleAndSummaryGenerated.data
													.status !== 200
											) {
												console.log(
													"Error: Something went wrong when creating the title and description"
												);
											}

											const stopProcessing =
												await axios.post(
													`${process.env.NEXT_API_HOST}recording/${data.userId}/complete`,
													{
														filename: data.filename,
													}
												);

											if (
												stopProcessing.data.status !==
												200
											) {
												console.log(
													"Something went wrong when stopping the process and trying to complete the processing stage"
												);
											}

											if (stopProcessing.status === 200) {
												fs.unlink(
													"temp_upload/" +
														data.filename,
													(err) => {
														if (!err)
															console.log(
																data.filename +
																	" deleted successfully"
															);
													}
												);
											}
										} else {
											console.log("Error. Upload fails");
										}
									}
								}
							}
						);
					}
				}
			});
		} catch (error) {
			console.log("ERROR processing video");
		}
	});

	socket.on("disconnect", async (data) => {
		console.log("🟢 Socket.id is disconnected ", socket.id);
	});
});

server.listen(port, '0.0.0.0', () => {
    console.log(`🟢 Listening on port ${port}`);
});

