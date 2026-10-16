const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const uploadDir = path.join(__dirname, '../img');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const allowed = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `upload-${crypto.randomBytes(16).toString('hex')}${allowed.get(file.mimetype) || '.bin'}`)
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const expectedExt = allowed.get(file.mimetype);
    const actualExt = path.extname(file.originalname).toLowerCase();
    if (!expectedExt || (actualExt !== expectedExt && !(expectedExt === '.jpg' && actualExt === '.jpeg'))) {
      return cb(new Error('Format d’image non autorisé. Utilisez JPG, PNG ou WebP.'));
    }
    cb(null, true);
  }
});

function hasValidSignature(filePath, mime) {
  const bytes = fs.readFileSync(filePath);
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function verifyAvatar(req, res, next) {
  upload.single('avatar')(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: error.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'Sélectionnez une image.' });
    try {
      if (!hasValidSignature(req.file.path, req.file.mimetype)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'Le fichier ne correspond pas à une image valide.' });
      }
      next();
    } catch (validationError) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Image invalide.' });
    }
  });
}

module.exports = { verifyAvatar };
