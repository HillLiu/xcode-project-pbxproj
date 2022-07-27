const process = require("process");
const fs = require("fs");
const path = require("path");
const pbxProject = require("./pbxProject");
const globSync = require("./globSync");

const fileExists = (f) => fs.existsSync(f);
const isDir = (d) => fileExists(d) && fs.lstatSync(d).isDirectory();
const idMap = Object.create(null);
const resourceExt = [".storyboard"];

const pbxPath = [
  "project.pbxproj",
  "Runner.xcodeproj/project.pbxproj",
  "ios/Runner.xcodeproj/project.pbxproj",
];

const searchProjectPbxproj = (p) => {
  const dirs = p.split("/");
  while (dirs.length !== 0) {
    let find;
    pbxPath.some((name) => {
      const cur = path.join("/", ...dirs, name);
      if (fileExists(cur)) {
        find = cur;
        return true;
      } else {
        return false;
      }
    });
    if (find) {
      return find;
      break;
    }
    dirs.pop();
  }
};

const init = (props) => {
  const cwd = process.cwd();
  const arg2 = process.argv[2];
  const willAdd = arg2 ? path.join(cwd, process.argv[2]) : null;
  const pbxprojFile = searchProjectPbxproj(cwd);

  if (isDir(willAdd) && pbxprojFile) {
    const myProj = pbxProject(pbxprojFile);
    myProj.parse(() => {
      const willAddName = path.basename(willAdd);
      myProj.addPbxGroup([], willAddName, willAddName, null, {
        appendTo: "Runner",
      });
      globSync(willAdd, {
        callback: (f) => {
          if (-1 !== resourceExt.indexOf(f.extname)) {
            myProj.addResourceFile(f.basename, {}, idMap[f.dirFullPath]);
          } else {
            myProj.addSourceFile(f.basename, {}, idMap[f.dirFullPath]);
          }
        },
        folderCallback: (d) => {
          const oGroup = myProj.addPbxGroup([], d.dirname, d.dirname, null, {
            appendTo: d.root,
          });
          idMap[d.fullPath] = oGroup.uuid;
        },
      });
      fs.writeFileSync("test.txt", myProj.writeSync());
    });
  } else {
    console.log(`xcode-pbx [your-code-folder]`);
  }
};

module.exports = {
  init,
};
