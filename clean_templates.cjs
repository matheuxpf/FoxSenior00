const fs = require('fs');
const path = require('path');

const templatesDir = path.join(__dirname, 'templates');

function cleanFile(filePath) {
    let content = fs.readFileSync(filePath, 'latin1'); // Read as latin1 to preserve accents like the Rust backend
    let lines = content.split(/\r?\n/);

    let parsedLines = [];
    for (let line of lines) {
        let fontStr = "";
        let text = "";
        if (line.includes('|')) {
            const parts = line.split('|');
            fontStr = parts[0];
            text = parts.slice(1).join('|').trimEnd(); // remove trailing spaces
        } else {
            fontStr = ""; // no prefix
            text = line.trimEnd();
        }
        parsedLines.push({ fontStr, text, original: line });
    }

    // 1. Remove trailing empty lines
    while (parsedLines.length > 0 && parsedLines[parsedLines.length - 1].text === "") {
        parsedLines.pop();
    }

    // 2. Compress consecutive empty lines to a maximum of 2
    let cleanedLines = [];
    let emptyCount = 0;

    for (let p of parsedLines) {
        if (p.text === "") {
            emptyCount++;
            if (emptyCount <= 2) {
                cleanedLines.push(p);
            }
        } else {
            emptyCount = 0;
            cleanedLines.push(p);
        }
    }

    // Reconstruct content
    let newContent = cleanedLines.map(p => {
        if (p.fontStr) {
            return `${p.fontStr}|${p.text}`;
        } else {
            return p.text;
        }
    }).join('\r\n');

    fs.writeFileSync(filePath, newContent, 'latin1');
}

const files = fs.readdirSync(templatesDir);
let count = 0;
for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.txt' || ext === '.out') {
        cleanFile(path.join(templatesDir, file));
        count++;
    }
}
console.log(`Cleaned ${count} templates successfully.`);
