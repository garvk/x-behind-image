const fs = require('fs');
const path = require('path');
const { registerFont } = require('canvas');
const fetch = require('node-fetch');

async function downloadFont(url, fontName) {
  const fontDir = path.join(__dirname, 'fonts');
  if (!fs.existsSync(fontDir)) {
    fs.mkdirSync(fontDir);
  }

  try {
    const response = await fetch(url);
    const css = await response.text();

    const fontUrls = css.match(/url\((https:\/\/.*?\.ttf)\)/g);

    if (fontUrls && fontUrls.length > 0) {
      const downloadedFonts = [];
      for (let i = 0; i < fontUrls.length; i++) {
        const fontUrl = fontUrls[i].slice(4, -1);
        const fontPath = path.join(fontDir, `${fontName.replace(/ /g, '')}-${i}.ttf`);

        // Check if the font file already exists
        if (!fs.existsSync(fontPath)) {
          const fontResponse = await fetch(fontUrl);
          const fontBuffer = await fontResponse.buffer();
          fs.writeFileSync(fontPath, fontBuffer);
          console.log(`Downloaded: ${fontName} (variant ${i + 1})`);
        } else {
          console.log(`Font already exists: ${fontName} (variant ${i + 1})`);
        }
        downloadedFonts.push(fontPath);
      }
      return downloadedFonts;
    } else {
      console.log(`No font files found for ${fontName}`);
      return [];
    }
  } catch (error) {
    console.error(`Error downloading ${fontName}: ${error.message}`);
    return [];
  }
}

async function loadFonts() {
  const fontsCss = fs.readFileSync(path.join(__dirname, 'app', 'fonts.css'), 'utf8');
  const fontUrls = fontsCss.match(/@import url\('(.*?)'\);/g);

  for (const urlString of fontUrls) {
    const url = urlString.match(/'(.*?)'/)[1];
    const fontName = url.split('family=')[1].split(':')[0].replace(/\+/g, ' ');

    const downloadedFonts = await downloadFont(url, fontName);
    
    downloadedFonts.forEach((fontPath, index) => {
      registerFont(fontPath, { family: fontName });
      console.log(`Registered: ${fontName} (variant ${index + 1})`);
    });
  }
}

// Execute the loadFonts function
loadFonts().then(() => {
  console.log('All fonts processed');
}).catch((error) => {
  console.error('Error processing fonts:', error);
});

module.exports = { loadFonts };
