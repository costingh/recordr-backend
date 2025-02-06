const express = require("express");
const multer = require("multer");
const fs = require("fs");
const {
	PutObjectCommand,
	HeadObjectCommand,
	S3Client,
} = require("@aws-sdk/client-s3");
const axios = require("axios");

const router = express.Router();
const upload = multer({ dest: "temp_upload/" });

// AWS S3 client configuration
const s3 = new S3Client({
	credentials: {
		accessKeyId: process.env.ACCESS_KEY,
		secretAccessKey: process.env.SECRET_KEY,
	},
	region: process.env.BUCKET_REGION,
});

// New endpoint to upload the video all at once
router.post("/upload-video", upload.single("video"), async (req, res) => {
	try {
		const file = req.file; // The uploaded file
		const userId = req.body.userId;

		if (!file) {
			return res.status(400).json({ message: "No file uploaded" });
		}

		console.log("🟢 Received file:", file.originalname);
		console.log("userId=", userId);

		const filePath = file.path; // Temporary file path
		const fileName = file.originalname; // File name
		const Bucket = process.env.BUCKET_NAME;
		const ContentType = file.mimetype; // MIME type of the uploaded video

		// Check if the file already exists in the S3 bucket
		try {
			await s3.send(new HeadObjectCommand({ Bucket, Key: fileName }));
			console.log("🔴 File with the same name already exists:", fileName);
			fs.unlinkSync(filePath); // Clean up the temporary file
			return res
				.status(409)
				.json({ message: "File with the same name already exists" });
		} catch (headErr) {
			// If the error is not a "Not Found" error, rethrow it
			if (headErr.name !== "NotFound") {
				console.error("Error checking if file exists in S3:", headErr);
				throw headErr;
			}
		}

		// Read the file into memory
		const fileBuffer = fs.readFileSync(filePath);

		// Create an S3 PutObjectCommand
		const command = new PutObjectCommand({
			Key: fileName,
			Bucket,
			ContentType,
			Body: fileBuffer,
		});

		// Upload the video to S3
		const uploadResponse = await s3.send(command);

		// Clean up the temporary file after upload
		fs.unlinkSync(filePath);

		// Check if upload was successful
		if (uploadResponse.$metadata.httpStatusCode === 200) {
			console.log("🟢 Successfully uploaded video to S3:", fileName);

			// Notify external API for processing
			const processingResponse = await axios.post(
				`${process.env.NEXT_API_HOST}/recording/${userId}/processing`,
				{ filename: fileName }
			);

			if (processingResponse.data.status === 200) {
				console.log(
					"🟢 Video processing started successfully:",
					fileName
				);
				return res
					.status(200)
					.json({ message: "File uploaded and processing started" });
			} else {
				return res
					.status(500)
					.json({ message: "Error starting video processing" });
			}
		} else {
			return res
				.status(500)
				.json({ message: "Error uploading file to S3" });
		}
	} catch (error) {
		console.error("Error uploading video:", error);
		return res
			.status(500)
			.json({ message: "Error uploading video", error });
	}
});

module.exports = router;
