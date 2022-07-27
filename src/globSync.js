const FS = require("fs");
const PATH = require("path");

const globSync = (folderPath, {callback, firstLevelOnly, folderCallback} = {}) => {
  const fileArr = FS.readdirSync(folderPath);
  while (fileArr.length !== 0) {
    const relativePath = fileArr.shift();
    const fullPath = PATH.join(folderPath, relativePath);
    if (FS.statSync(fullPath).isDirectory()) {
      if (!firstLevelOnly) {
        if (folderCallback) {
          folderCallback({
            fullPath,
            relativePath,
            dirname: PATH.basename(fullPath),
            root: PATH.basename(PATH.dirname(fullPath)),
          });
        }
        fileArr.push(
          ...FS.readdirSync(fullPath).map((v) => PATH.join(relativePath, v))
        );
      }
    } else if (callback) {
      const extname = PATH.extname(relativePath);
      const dirFullPath = PATH.dirname(fullPath);
      callback({
        fullPath,
        relativePath,
        extname,
        filename: PATH.basename(relativePath, extname),
        basename: PATH.basename(relativePath),
        dirname: PATH.basename(dirFullPath),
        dirFullPath,
      });
    }
  }
};

module.exports = globSync;
