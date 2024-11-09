const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Client } = require('@replit/object-storage');
const { removeImageBackground, addTextToImage, previewImage } = require('./api/bgremoval');
const { loadFonts } = require('./fontLoader');

// const objectStorage = new Client();
let objectStorage;
try {
    objectStorage = new Client();
    console.log('Object Storage initialized successfully');
} catch (error) {
    console.error('Failed to initialize Object Storage:', error);
}


// Configuration for image retention (in days)
const IMAGE_RETENTION_DAYS = process.env.IMAGE_RETENTION_DAYS || 7;
const isLocalDevelopment = !process.env.REPL_SLUG || !process.env.REPL_OWNER;

const getReplitUrl = () => {
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
        return `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    }
    // Fallback for local development or when env vars aren't available
    return `${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`;
};

const app = express();
const upload = multer({ dest: 'uploads/' });
loadFonts();

app.use(bodyParser.json());

const port = process.env.PORT || 3000;

// Add the storage status endpoint
app.get('/api/storage-status', async (req, res) => {
    try {
        if (!objectStorage) {
            return res.status(500).json({
                success: false,
                error: 'Object Storage not initialized',
                initialized: false
            });
        }

        // Test if we can list files
        const files = await objectStorage.list();
        res.json({
            success: true,
            initialized: true,
            fileCount: files.length,
            files: files
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            initialized: !!objectStorage
        });
    }
});
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
        const imagePath = req.file.path;
        const resultDataURL = await removeImageBackground(imagePath);
        const outputPath = path.join('uploads', `bg_removed_${req.file.filename}.png`);

        fs.writeFileSync(outputPath, resultDataURL.split(';base64,').pop(), { encoding: 'base64' });

        res.json({ success: true, removedBgImagePath: outputPath, originalImagePath: imagePath });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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
        const { originalImagePath, removedBgImagePath, textParams } = req.body;
        const finalBuffer = await previewImage(originalImagePath, removedBgImagePath, textParams);

        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const filename = `preview_${timestamp}.png`;

        // Save locally for immediate response
        const finalPath = path.join('uploads', filename);
        fs.writeFileSync(finalPath, finalBuffer);


        try {
            // Upload to Replit Object Storage only in deployed environment
            await objectStorage.uploadFromFilename(filename, finalBuffer, {
                metadata: {
                    createdAt: timestamp.toString(),
                    expiresAt: (timestamp + (IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000)).toString()
                }
            });

            const imageUrl = `https://${getReplitUrl()}/images/${filename}`;
            res.set('X-Image-URL', imageUrl);
            res.set('X-Expires-In', `${IMAGE_RETENTION_DAYS} days`);
        } catch (storageError) {
            console.error('Object Storage error:', storageError);
            res.set('X-Image-URL', 'NOT SET');
            res.set('X-ERROR', storageError)
            // Continue without setting URL headers
        }

        // Always send the file response
        res.sendFile(finalPath, { root: __dirname });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Add a cleanup job to remove expired images
async function cleanupExpiredImages() {
    try {
        const files = await objectStorage.list();
        const now = Date.now();
        for (const file of files) {
            const metadata = await objectStorage.getMetadata(file.name);
            if (metadata.expiresAt && parseInt(metadata.expiresAt) < now) {
                await objectStorage.delete(file.name);
                console.log(`Deleted expired image: ${file.name}`);
            }
        }
    } catch (error) {
        console.error('Error cleaning up expired images:', error);
    }
}

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

// Run cleanup job daily
setInterval(cleanupExpiredImages, 24 * 60 * 60 * 1000);

module.exports = app;
