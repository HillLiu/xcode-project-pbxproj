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
  const arg3 = process.argv[3];
  const pbxprojFile = searchProjectPbxproj(cwd);

  if (arg2 === 'search') {
    console.log({pbxprojFile});
    process.exit();
  }

  const willAdd = arg2 ? path.join(cwd, process.argv[2]) : null;

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
      if (null != arg3) {
        if (arg3 === "--write") {
          fs.writeFileSync(pbxprojFile, myProj.writeSync());
        } else {
          fs.writeFileSync(path.join(cwd, arg3), myProj.writeSync());
        }
      } else {
        console.log(myProj.writeSync());
      }
    });
  } else {
    console.log(`
      xcode-flutter [your-code-folder]
      xcode-flutter [your-code-folder] --write
      xcode-flutter [your-code-folder] [output-file] 
      xcode-flutter search 
    `);
  }
};

module.exports = {
  init,
};
