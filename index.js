const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { removeImageBackground, addTextToImage, previewImage } = require('./api/bgremoval');
const { loadFonts } = require('./fontLoader');
const imagekit = require('./imagekit-config');

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}


const app = express();
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '.png')
  }
});
const upload = multer({ storage: storage });
loadFonts();



app.use(bodyParser.json());

// At the top of index.js
const STORAGE_CONFIG = {
  local: process.env.USE_LOCAL_STORAGE === 'true' || process.env.NODE_ENV === 'development',
  imageKit: process.env.USE_IMAGEKIT === 'true' || process.env.NODE_ENV === 'production'
};

// Helper function for storage decisions
function getStorageConfig(req) {
  const username = req.body.username || req.query.username || 'default';
  return {
    useLocal: req.query.storage === 'local' || STORAGE_CONFIG.local,
    useImageKit: req.query.storage === 'imagekit' || STORAGE_CONFIG.imageKit,
    username: username,
    localBasePath: path.join('uploads', username),
    imageKitBasePath: `xbehindimage/${username}`
  };
}

const port = process.env.PORT || 3000;


// Add a basic health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// 1. Remove background API
app.post('/api/remove-background', upload.single('image'), async (req, res) => {
    try {
        const { useLocal, useImageKit, username, localBasePath, imageKitBasePath } = getStorageConfig(req);
        const imagePath = req.file.path;
        const resultDataURL = await removeImageBackground(imagePath);
        const buffer = Buffer.from(resultDataURL.split(';base64,').pop(), 'base64');
        const filename = `bg_removed_${req.file.filename}`; // For processed image
        let response = { success: true };

        // Save original image
        if (useLocal) {
            fs.mkdirSync(localBasePath, { recursive: true });
            const originalPath = path.join(localBasePath, req.file.filename);
            fs.copyFileSync(imagePath, originalPath); // Copy original file
            const outputPath = path.join(localBasePath, filename);
            fs.writeFileSync(outputPath, buffer);
            response.localPath = outputPath;
            response.originalLocalPath = originalPath;
        }

        // Save to ImageKit
        if (useImageKit) {
            try {
                // Upload original image
                const originalBuffer = fs.readFileSync(imagePath);
                const originalUpload = await imagekit.upload({
                    file: originalBuffer,
                    fileName: req.file.filename,
                    folder: imageKitBasePath,
                    tags: ["original", username],
                    metadata: { username: username }
                });

                // Upload processed image
                const processedUpload = await imagekit.upload({
                    file: buffer,
                    fileName: filename,
                    folder: imageKitBasePath,
                    tags: ["background-removed", username],
                    metadata: { username: username }
                });

                response.imageKitUrl = processedUpload.url;
                response.originalImageKitUrl = originalUpload.url;
                response.fileId = processedUpload.fileId;
                response.originalFileId = originalUpload.fileId;
            } catch (uploadError) {
                console.error('ImageKit upload error:', uploadError);
                response.imageKitError = uploadError.message;
            }
        }

        // Clean up temporary file
        fs.unlinkSync(imagePath);

        res.json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// app.post('/api/remove-background', upload.single('image'), async (req, res) => {
//     try {
//         const imagePath = req.file.path;
//         const resultDataURL = await removeImageBackground(imagePath);
//         const outputPath = path.join('uploads', `bg_removed_${req.file.filename}.png`);

//         fs.writeFileSync(outputPath, resultDataURL.split(';base64,').pop(), { encoding: 'base64' });

//         res.json({ success: true, removedBgImagePath: outputPath, originalImagePath: imagePath });
//     } catch (error) {
//         res.status(500).json({ success: false, error: error.message });
//     }
// });

// 2. Add text to image API
app.post('/api/add-text', async (req, res) => {
    try {
        const { imagePath, textParams } = req.body;
        const resultBuffer = await addTextToImage(imagePath, textParams);
        const outputPath = path.join('uploads', `text_added_${path.basename(imagePath)}`);

        fs.writeFileSync(outputPath, resultBuffer);

        res.json({ success: true, imagePath: outputPath });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Preview image API
app.post('/api/preview-image', async (req, res) => {
    try {
        const { useLocal, useImageKit, username, localBasePath, imageKitBasePath } = getStorageConfig(req);
        const { originalImagePath, removedBgImagePath, textParams } = req.body;
        const finalBuffer = await previewImage(originalImagePath, removedBgImagePath, textParams);
        const timestamp = Date.now();
        const filename = `preview_${timestamp}.png`;
        let response = { success: true };

        // Local Storage
        if (useLocal) {
            // Create user directory if it doesn't exist
            fs.mkdirSync(localBasePath, { recursive: true });
            const finalPath = path.join(localBasePath, filename);
            fs.writeFileSync(finalPath, finalBuffer);
            response.localPath = finalPath;
        }

        // ImageKit Storage
        if (useImageKit) {
            try {
                const uploadResponse = await imagekit.upload({
                    file: finalBuffer,
                    fileName: filename,
                    folder: imageKitBasePath, // Remove 'previews' subdirectory
                    tags: ["preview", username],
                    metadata: {
                        username: username,
                        createdAt: timestamp.toString(),
                        expiresAt: (timestamp + (24 * 60 * 60 * 1000)).toString()
                    }
                });
                response.imageKitUrl = uploadResponse.url;
                response.fileId = uploadResponse.fileId;

            } catch (uploadError) {
                console.error('ImageKit upload error:', uploadError);
                response.imageKitError = uploadError.message;
            }
        }

        if (!useLocal && !useImageKit) {
            throw new Error('No storage method selected');
        }

        // If local storage is used, send the file
        if (useLocal && !useImageKit) {
            return res.sendFile(response.localPath, { root: __dirname });
        }

        res.json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// app.post('/api/preview-image', async (req, res) => {
//     try {
//         const { originalImagePath, removedBgImagePath, textParams } = req.body;
//         const finalBuffer = await previewImage(originalImagePath, removedBgImagePath, textParams);

//         // Generate unique filename with timestamp
//         const timestamp = Date.now();
//         const filename = `preview_${timestamp}.png`;

//         // Save locally for immediate response
//         const finalPath = path.join('uploads', filename);
//         fs.writeFileSync(finalPath, finalBuffer);


//         try {
//             // Upload to ImageKit
//             const uploadResponse = await imagekit.upload({
//                 file: finalBuffer,
//                 fileName: filename,
//                 folder: "/previews",  // Optional: organize in folders
//                 tags: ["preview"],    // Optional: add tags
//                 metadata: {           // Optional: add metadata
//                     createdAt: timestamp.toString(),
//                     expiresAt: (timestamp + (24 * 60 * 60 * 1000)).toString() // 24 hours
//                 }
//             });
//             // Return the ImageKit URL
//             res.json({
//                 success: true,
//                 imageUrl: uploadResponse.url,
//                 fileId: uploadResponse.fileId
//             });

//             res.set('X-Image-URL', uploadResponse.url);
//             res.set('X-Expires-In', `${IMAGE_RETENTION_DAYS} days`);
//         } catch (storageError) {
//             console.error('ImageKit upload error:', uploadError);
//             // Fallback to local file if upload fails
//             res.set('X-Image-URL', 'NOT SET');
//             res.set('X-ERROR', storageError)
//         }

//         // Always send the file response
//         res.sendFile(finalPath, { root: __dirname });
//     } catch (error) {
//         res.status(500).json({ success: false, error: error.message });
//     }
// });

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

async function cleanupExpiredImages() {
    try {
        // List files from ImageKit
        const files = await imagekit.listFiles({
            path: 'xbehindimage', // Root path only
            tags: ['preview'],
            includeFolder: true
        });

        const now = Date.now();

        // Delete expired files
        for (const file of files) {
            if (file.metadata && file.metadata.expiresAt) {
                const expiryTime = parseInt(file.metadata.expiresAt);
                if (expiryTime < now) {
                    await imagekit.deleteFile(file.fileId);
                    console.log(`Deleted expired image: ${file.name} for user: ${file.metadata.username}`);
                }
            }
        }
    } catch (error) {
        console.error('Error cleaning up expired images:', error);
    }
}

// Run cleanup job every 24 hours
setInterval(cleanupExpiredImages, 24 * 60 * 60 * 1000);

app.get('/api/debug', (req, res) => {
    res.json({
        environment: {
            REPL_SLUG: process.env.REPL_SLUG,
            REPL_OWNER: process.env.REPL_OWNER,
            isLocalDevelopment,
            objectStorageBucket: process.env.REPLIT_DB_ID
        },
        replitUrl: getReplitUrl()
    });
});


module.exports = app;
