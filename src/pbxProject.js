/**
 Licensed to the Apache Software Foundation (ASF) under one
 or more contributor license agreements.  See the NOTICE file
 distributed with this work for additional information
 regarding copyright ownership.  The ASF licenses this file
 to you under the Apache License, Version 2.0 (the
 'License'); you may not use this file except in compliance
 with the License.  You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 'AS IS' BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
 */

const pbxGroupChild = require("./pbxGroupChild");

var util = require("util"),
  f = util.format,
  EventEmitter = require("events").EventEmitter,
  $path = require("path"),
  $uuid = require("uuid"),
  fork = require("child_process").fork,
  pbxWriter = require("./pbxWriter"),
  pbxFile = require("./pbxFile"),
  constants = require("./constants"),
  fs = require("fs"),
  parser = require("./parser/pbxproj"),
  plist = require("simple-plist"),
  COMMENT_KEY = /_comment$/,
  NO_SPECIAL_SYMBOLS = /^[a-zA-Z0-9_\.\$]+\.[a-zA-Z]+$/,
  isSourceFileType = constants.isSourceFileType,
  isHeaderFileType = constants.isHeaderFileType,
  isResource = constants.isResource,
  isEntitlementFileType = constants.isEntitlementFileType,
  isAssetFileType = constants.isAssetFileType,
  isPlistFileType = constants.isPlistFileType,
  isModuleMapFileType = constants.isModuleMapFileType;

function pbxProject(filename) {
  if (!(this instanceof pbxProject)) return new pbxProject(filename);

  this.filepath = $path.resolve(filename);
}

util.inherits(pbxProject, EventEmitter);

pbxProject.prototype.parse = function (cb) {
  var worker = fork(__dirname + "/parseJob.js", [this.filepath]);

  worker.on(
    "message",
    function (msg) {
      if (msg.name == "SyntaxError" || msg.code) {
        this.emit("error", msg);
      } else {
        this.hash = msg;
        this.emit("end", null, msg);
      }
    }.bind(this)
  );

  if (cb) {
    this.on("error", cb);
    this.on("end", cb);
  }

  return this;
};

pbxProject.prototype.parseSync = function () {
  var file_contents = fs.readFileSync(this.filepath, "utf-8");

  this.hash = parser.parse(file_contents);
  return this;
};

pbxProject.prototype.writeSync = function (options) {
  this.writer = new pbxWriter(this.hash, options);
  return this.writer.writeSync();
};

pbxProject.prototype.allUuids = function () {
  var sections = this.hash.project.objects,
    uuids = [],
    section;

  for (var key in sections) {
    section = sections[key];
    uuids = uuids.concat(Object.keys(section));
  }

  uuids = uuids.filter(function (str) {
    return !COMMENT_KEY.test(str) && str.length == 24;
  });

  return uuids;
};

pbxProject.prototype.generateUuid = function () {
  var id = $uuid.v4().replace(/-/g, "").substr(0, 24).toUpperCase();

  if (this.allUuids().indexOf(id) >= 0) {
    return this.generateUuid();
  } else {
    return id;
  }
};

pbxProject.prototype.addPluginFile = function (path, opt) {
  var file = new pbxFile(path, opt);

  file.plugin = true; // durr
  correctForPluginsPath(file, this);

  // null is better for early errors
  if (this.hasFile(file.path)) return null;

  file.fileRef = this.generateUuid();

  this.addToPbxFileReferenceSection(file); // PBXFileReference
  this.addToPluginsPbxGroup(file); // PBXGroup

  return file;
};

pbxProject.prototype.removePluginFile = function (path, opt) {
  var file = new pbxFile(path, opt);
  correctForPluginsPath(file, this);

  this.removeFromPbxFileReferenceSection(file); // PBXFileReference
  this.removeFromPluginsPbxGroup(file); // PBXGroup

  return file;
};

pbxProject.prototype.addProductFile = function (targetPath, opt) {
  var file = new pbxFile(targetPath, opt);

  file.includeInIndex = 0;
  file.fileRef = this.generateUuid();
  file.target = opt ? opt.target : undefined;
  file.group = opt ? opt.group : undefined;
  file.uuid = this.generateUuid();
  file.path = file.basename;

  this.addToPbxFileReferenceSection(file);
  this.addToProductsPbxGroup(file); // PBXGroup

  return file;
};

pbxProject.prototype.removeProductFile = function (path, opt) {
  var file = new pbxFile(path, opt);

  this.removeFromProductsPbxGroup(file); // PBXGroup

  return file;
};

/**
 *
 * @param path {String}
 * @param opt {Object} see pbxFile for avail options
 * @param group {String} group key
 * @returns {Object} file; see pbxFile
 */
pbxProject.prototype.addSourceFile = function (path, opt, group) {
  var file;
  if (group) {
    file = this.addFile(path, group, opt);
  } else {
    file = this.addPluginFile(path, opt);
  }

  if (!file) return false;

  file.target = opt ? opt.target : undefined;
  file.uuid = this.generateUuid();

  this.addToPbxBuildFileSection(file); // PBXBuildFile
  this.addToPbxSourcesBuildPhase(file); // PBXSourcesBuildPhase

  return file;
};

/**
 *
 * @param path {String}
 * @param opt {Object} see pbxFile for avail options
 * @param group {String} group key
 * @returns {Object} file; see pbxFile
 */
pbxProject.prototype.removeSourceFile = function (path, opt, group) {
  var file;
  if (group) {
    file = this.removeFile(path, group, opt);
  } else {
    file = this.removePluginFile(path, opt);
  }
  file.target = opt ? opt.target : undefined;
  this.removeFromPbxBuildFileSection(file); // PBXBuildFile
  this.removeFromPbxSourcesBuildPhase(file); // PBXSourcesBuildPhase

  return file;
};

/**
 *
 * @param path {String}
 * @param opt {Object} see pbxFile for avail options
 * @param group {String} group key
 * @returns {Object} file; see pbxFile
 */
pbxProject.prototype.addHeaderFile = function (path, opt, group) {
  if (group) {
    return this.addFile(path, group, opt);
  } else {
    return this.addPluginFile(path, opt);
  }
};

/**
 *
 * @param path {String}
 * @param opt {Object} see pbxFile for avail options
 * @param group {String} group key
 * @returns {Object} file; see pbxFile
 */
pbxProject.prototype.removeHeaderFile = function (path, opt, group) {
  if (group) {
    return this.removeFile(path, group, opt);
  } else {
    return this.removePluginFile(path, opt);
  }
};

/**
 *
 * @param path {String}
 * @param opt {Object} see pbxFile for avail options
 * @param group {String} group key
 * @returns {Object} file; see pbxFile
 */
pbxProject.prototype.addResourceFile = function (path, opt, group) {
  opt = opt || {};

  var file;

  if (opt.plugin) {
    file = this.addPluginFile(path, opt);
    if (!file) return false;
  } else {
    file = new pbxFile(path, opt);
    if (this.hasFile(file.path)) return false;
  }

  file.uuid = this.generateUuid();
  file.target = opt ? opt.target : undefined;

  if (!opt.plugin) {
    correctForResourcesPath(file, this);
    file.fileRef = this.generateUuid();
  }

  if (!opt.variantGroup) {
    this.addToPbxBuildFileSection(file); // PBXBuildFile
    this.addToPbxResourcesBuildPhase(file); // PBXResourcesBuildPhase
  }

  if (!opt.plugin) {
    this.addToPbxFileReferenceSection(file); // PBXFileReference
    if (group) {
      if (this.getPBXGroupByKey(group)) {
        this.addToPbxGroup(file, group); //Group other than Resources (i.e. 'splash')
      } else if (this.getPBXVariantGroupByKey(group)) {
        this.addToPbxVariantGroup(file, group); // PBXVariantGroup
      }
    } else {
      this.addToResourcesPbxGroup(file); // PBXGroup
    }
  }

  return file;
};

/**
 *
 * @param path {String}
 * @param opt {Object} see pbxFile for avail options
 * @param group {String} group key
 * @returns {Object} file; see pbxFile
 */
pbxProject.prototype.removeResourceFile = function (path, opt, group) {
  var file = new pbxFile(path, opt);
  file.target = opt ? opt.target : undefined;

  correctForResourcesPath(file, this);

  this.removeFromPbxBuildFileSection(file); // PBXBuildFile
  this.removeFromPbxFileReferenceSection(file); // PBXFileReference
  if (group) {
    if (this.getPBXGroupByKey(group)) {
      this.removeFromPbxGroup(file, group); //Group other than Resources (i.e. 'splash')
    } else if (this.getPBXVariantGroupByKey(group)) {
      this.removeFromPbxVariantGroup(file, group); // PBXVariantGroup
    }
  } else {
    this.removeFromResourcesPbxGroup(file); // PBXGroup
  }
  this.removeFromPbxResourcesBuildPhase(file); // PBXResourcesBuildPhase

  return file;
};

pbxProject.prototype.addFramework = function (fpath, opt) {
  var customFramework = opt && opt.customFramework == true;
  var link = !opt || opt.link == undefined || opt.link; //defaults to true if not specified
  var embed = opt && opt.embed; //defaults to false if not specified

  if (opt) {
    delete opt.embed;
  }

  var file = new pbxFile(fpath, opt);

  file.uuid = this.generateUuid();
  file.fileRef = this.generateUuid();
  file.target = opt ? opt.target : undefined;

  var fileReference = this.hasFile(file.path);
  if (fileReference) {
    var key = this.getFileKey(file.path);
    file.fileRef = key;
  } else {
    this.addToPbxFileReferenceSection(file); // PBXFileReference
    this.addToFrameworksPbxGroup(file); // PBXGroup
  }

  if (link) {
    const buildFileUuid = this.addToPbxFrameworksBuildPhase(file);
    if (buildFileUuid === file.uuid) {
      // PBXFrameworksBuildPhase)
      this.addToPbxBuildFileSection(file); // PBXBuildFile
    } else {
      file.uuid = buildFileUuid;
    }
  }

  if (customFramework) {
    this.addToFrameworkSearchPaths(file);

    if (embed) {
      opt.embed = embed;
      var embeddedFile = new pbxFile(fpath, opt);

      embeddedFile.uuid = this.generateUuid();
      embeddedFile.fileRef = file.fileRef;
      embeddedFile.target = file.target;
      const embedBuildFileUuid =
        this.addToPbxEmbedFrameworksBuildPhase(embeddedFile);
      if (embedBuildFileUuid === embeddedFile.uuid) {
        // PBXCopyFilesBuildPhase
        //keeping a separate PBXBuildFile entry for Embed Frameworks
        this.addToPbxBuildFileSection(embeddedFile); // PBXBuildFile
      } else {
        embeddedFile.uuid = embedBuildFileUuid;
      }

      return embeddedFile;
    }
  }

  return file;
};

pbxProject.prototype.removeFramework = function (fpath, opt) {
  var embed = opt && opt.embed;

  if (opt) {
    delete opt.embed;
  }

  var file = new pbxFile(fpath, opt);
  file.target = opt ? opt.target : undefined;

  this.removeFromPbxBuildFileSection(file); // PBXBuildFile
  this.removeFromPbxFileReferenceSection(file); // PBXFileReference
  this.removeFromFrameworksPbxGroup(file); // PBXGroup
  this.removeFromPbxFrameworksBuildPhase(file); // PBXFrameworksBuildPhase

  if (opt && opt.customFramework) {
    this.removeFromFrameworkSearchPaths(file);
  }

  opt = opt || {};
  opt.embed = true;
  var embeddedFile = new pbxFile(fpath, opt);

  embeddedFile.fileRef = file.fileRef;

  this.removeFromPbxBuildFileSection(embeddedFile); // PBXBuildFile
  this.removeFromPbxEmbedFrameworksBuildPhase(embeddedFile); // PBXCopyFilesBuildPhase

  return file;
};

pbxProject.prototype.addCopyfile = function (fpath, opt) {
  var file = new pbxFile(fpath, opt);

  // catch duplicates
  if (this.hasFile(file.path)) {
    file = this.hasFile(file.path);
  }

  file.fileRef = file.uuid = this.generateUuid();
  file.target = opt ? opt.target : undefined;

  this.addToPbxBuildFileSection(file); // PBXBuildFile
  this.addToPbxFileReferenceSection(file); // PBXFileReference
  this.addToPbxCopyfilesBuildPhase(file); // PBXCopyFilesBuildPhase

  return file;
};

pbxProject.prototype.pbxCopyfilesBuildPhaseObj = function (target) {
  return this.buildPhaseObject("PBXCopyFilesBuildPhase", "Copy Files", target);
};

pbxProject.prototype.addToPbxCopyfilesBuildPhase = function (
  file,
  comment,
  target
) {
  var sources = this.buildPhaseObject(
    "PBXCopyFilesBuildPhase",
    comment || "Copy Files",
    target || file.target
  );
  sources.files.push(pbxBuildPhaseObj(file));
};

pbxProject.prototype.removeCopyfile = function (fpath, opt) {
  var file = new pbxFile(fpath, opt);
  file.target = opt ? opt.target : undefined;

  this.removeFromPbxBuildFileSection(file); // PBXBuildFile
  this.removeFromPbxFileReferenceSection(file); // PBXFileReference
  this.removeFromPbxCopyfilesBuildPhase(file); // PBXFrameworksBuildPhase

  return file;
};

pbxProject.prototype.removeFromPbxCopyfilesBuildPhase = function (file) {
  var sources = this.pbxCopyfilesBuildPhaseObj(file.target);
  for (var i in sources.files) {
    if (sources.files[i].comment == longComment(file)) {
      sources.files.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addStaticLibrary = function (path, opt) {
  opt = opt || {};

  var file;

  if (opt.plugin) {
    file = this.addPluginFile(path, opt);
    if (!file) return false;
  } else {
    file = new pbxFile(path, opt);
    if (this.hasFile(file.path)) return false;
  }

  file.uuid = this.generateUuid();
  file.target = opt ? opt.target : undefined;

  if (!opt.plugin) {
    file.fileRef = this.generateUuid();
    this.addToPbxFileReferenceSection(file); // PBXFileReference
  }

  this.addToPbxBuildFileSection(file); // PBXBuildFile
  this.addToPbxFrameworksBuildPhase(file); // PBXFrameworksBuildPhase
  this.addToLibrarySearchPaths(file); // make sure it gets built!

  return file;
};

// helper addition functions
pbxProject.prototype.addToPbxBuildFileSection = function (file) {
  var commentKey = f("%s_comment", file.uuid);

  this.pbxBuildFileSection()[file.uuid] = pbxBuildFileObj(file);
  this.pbxBuildFileSection()[commentKey] = pbxBuildFileComment(file);
};

pbxProject.prototype.removeFromPbxBuildFileSection = function (file) {
  var fileUuid;

  for (fileUuid in this.pbxBuildFileSection()) {
    if (this.pbxBuildFileSection()[fileUuid].fileRef_comment == file.basename) {
      file.uuid = fileUuid;
      this.removeFromPbxBuildFileSectionByUuid(fileUuid);
    }
  }
};

pbxProject.prototype.removeFromPbxBuildFileSectionByFileRef = function (file) {
  var fileUuid;
  var pbxBuildFileSection = this.pbxBuildFileSection();

  for (fileUuid in pbxBuildFileSection) {
    if (pbxBuildFileSection[fileUuid].fileRef == file.uuid) {
      this.removeFromPbxBuildFileSectionByUuid(fileUuid);
    }
  }
};

pbxProject.prototype.removeFromPbxBuildFileSectionByUuid = function (itemUuid) {
  var buildSection = this.pbxBuildFileSection();
  removeItemAndCommentFromSectionByUuid(buildSection, itemUuid);
};

pbxProject.prototype.findMainPbxGroup = function () {
  var groups = this.hash.project.objects["PBXGroup"];
  var candidates = [];
  for (var key in groups) {
    if (!groups[key].path && !groups[key].name && groups[key].isa) {
      candidates.push(groups[key]);
    }
  }
  if (candidates.length == 1) {
    return candidates[0];
  }

  return null;
};

pbxProject.prototype.addPbxGroup = function (
  filePathsArray,
  name,
  path,
  sourceTree,
  opt
) {
  opt = opt || {};
  var srcRootPath = $path.dirname($path.dirname(this.filepath));
  var groups = this.hash.project.objects["PBXGroup"],
    pbxGroupUuid = opt.uuid || this.generateUuid(),
    commentKey = f("%s_comment", pbxGroupUuid),
    groupName = constants.quoteIfNeeded(name),
    pbxGroup = {
      isa: "PBXGroup",
      children: [],
      name: groupName,
      sourceTree: sourceTree ? sourceTree : '"<group>"',
    },
    fileReferenceSection = this.pbxFileReferenceSection(),
    filePathToReference = {};

  //path is mandatory only for the main group
  if (!opt.filesRelativeToProject) {
    pbxGroup.path = path;
  }

  for (var key in fileReferenceSection) {
    // only look for comments
    if (!COMMENT_KEY.test(key)) continue;

    var fileReferenceKey = key.split(COMMENT_KEY)[0],
      fileReference = fileReferenceSection[fileReferenceKey];

    filePathToReference[fileReference.path] = {
      fileRef: fileReferenceKey,
      basename: fileReferenceSection[key],
    };
  }

  for (var index = 0; index < filePathsArray.length; index++) {
    var filePath = filePathsArray[index],
      filePathQuoted = '"' + filePath + '"';
    if (filePathToReference[filePath]) {
      pbxGroup.children.push(pbxGroupChild(filePathToReference[filePath]));
      continue;
    } else if (filePathToReference[filePathQuoted]) {
      pbxGroup.children.push(
        pbxGroupChild(filePathToReference[filePathQuoted])
      );
      continue;
    }

    var relativePath = $path.relative(srcRootPath, filePath);
    var file = new pbxFile(
      opt.filesRelativeToProject ? relativePath : filePath
    );
    file.uuid = this.generateUuid();
    file.fileRef = this.generateUuid();
    if (opt.target) {
      file.target = opt.target;
    }
    if (
      fs.existsSync(filePath) &&
      fs.lstatSync(filePath).isDirectory() &&
      !isAssetFileType(file.lastKnownFileType)
    ) {
      if ($path.extname(filePath) === ".lproj") {
        continue;
      }
      file.fileRef = file.uuid;
      var files = fs.readdirSync(filePath).map((p) => $path.join(filePath, p));
      this.addToPbxFileReferenceSection(file); // PBXFileReference
      this.addToPbxBuildFileSection(file);
      pbxGroup.children.push(pbxGroupChild(file));
      this.addPbxGroup(files, $path.basename(filePath), filePath, null, {
        uuid: file.uuid,
        filesRelativeToProject: opt.filesRelativeToProject,
        target: opt.target,
      });
    } else {
      this.addToPbxFileReferenceSection(file); // PBXFileReference
      pbxGroup.children.push(pbxGroupChild(file));
      if (
        isHeaderFileType(file.lastKnownFileType) ||
        isPlistFileType(file.lastKnownFileType) ||
        isModuleMapFileType(file.lastKnownFileType)
      ) {
        continue;
      }

      if (isEntitlementFileType(file.lastKnownFileType)) {
        this.addToBuildSettings(
          "CODE_SIGN_ENTITLEMENTS",
          constants.quoteIfNeeded(file.path),
          opt.target
        );
        continue;
      }

      if (isSourceFileType(file.lastKnownFileType)) {
        // PBXBuildFile
        this.addToPbxSourcesBuildPhase(file);
      } else if (isResource(file.group)) {
        this.addToPbxResourcesBuildPhase(file);
      }

      this.addToPbxBuildFileSection(file);
    }
  }

  handleLocalization.call(this, filePathsArray, pbxGroup, srcRootPath, opt);

  if (groups) {
    groups[pbxGroupUuid] = pbxGroup;
    groups[commentKey] = name;
  }

  const pbxRef = pbxGroupChild({
    fileRef: pbxGroupUuid,
    basename: name,
  });

  if (opt.isMain) {
    let mainGroup = this.findMainPbxGroup();
    if (mainGroup) {
      mainGroup.children.push(pbxRef);
    }
  }

  if (opt.appendTo) {
    const appendTo = this.pbxGroupByName(opt.appendTo);
    if (appendTo) {
      if (!appendTo.children) {
        appendTo.children = [];
      } 
      appendTo.children.push(pbxRef);
    }
  }

  return { uuid: pbxGroupUuid, pbxGroup: pbxGroup, pbxRef };
};

function handleLocalization(files, pbxGroup, srcRootPath, opt) {
  var storyboardNames = {};
  var allNames = {};
  var regions = {};

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const parsedPath = $path.parse(filePath);
    if ($path.extname(filePath) === ".lproj") {
      var regionName = parsedPath.name;
      var region = (regions[regionName] = {});
      var regionFiles = fs.readdirSync(filePath);
      this.addKnownRegion(regionName);
      for (let j = 0; j < regionFiles.length; j++) {
        var regionFilePath = regionFiles[j];
        var parsedRegionFilePath = $path.parse(regionFilePath);
        var regionFileName = parsedRegionFilePath.name;
        if (parsedRegionFilePath.ext === ".storyboard") {
          storyboardNames[parsedRegionFilePath.name] = true;
        }
        var fileRegions = (allNames[parsedRegionFilePath.name] =
          allNames[parsedRegionFilePath.name] || []);
        fileRegions.push(regionName);
        region[regionFileName] = $path.join(filePath, regionFilePath);
      }
    }
  }

  for (var name in allNames) {
    var fileRegionsForName = allNames[name];
    var variantGroupName = storyboardNames[name]
      ? name + ".storyboard"
      : name + ".strings";

    var variantGroup = this.addLocalizationVariantGroup(variantGroupName, {
      target: opt.target,
      skipAddToResourcesGroup: true,
    });
    pbxGroup.children.push(pbxGroupChild(variantGroup));
    for (let k = 0; k < fileRegionsForName.length; k++) {
      var file = regions[fileRegionsForName[k]][name];
      var refFile = new pbxFile($path.relative(srcRootPath, file), {
        basename: fileRegionsForName[k],
      });
      refFile.fileRef = this.generateUuid();
      this.addToPbxFileReferenceSection(refFile);
      this.addToPbxVariantGroup(refFile, variantGroup.fileRef);
    }
  }
}

pbxProject.prototype.removePbxGroup = function (groupName, path) {
  var groupKey =
    this.findPBXGroupKey({ name: groupName }) ||
    this.findPBXVariantGroupKey({ name: groupName });
  if (!groupKey) {
    return;
  }

  this.removePbxGroupByKey(groupKey, path);
};

pbxProject.prototype.removePbxGroupByKey = function (groupKey, path) {
  var group =
    this.getPBXGroupByKey(groupKey) || this.getPBXVariantGroupByKey(groupKey);

  if (!group) {
    return;
  }

  path = path || "";
  var children = group.children;

  for (i in children) {
    var file = new pbxFile($path.join(path, children[i].comment));
    file.fileRef = children[i].value;
    file.uuid = file.fileRef;
    this.removePbxGroupByKey(
      children[i].value,
      $path.join(path, children[i].comment)
    );
    this.removeFromPbxFileReferenceSectionByUuid(children[i].value);
    this.removeFromPbxBuildFileSectionByFileRef(file);
    this.removeFromPbxSourcesBuildPhase(file);
  }

  var mainGroup = this.findMainPbxGroup();
  if (mainGroup) {
    var mainGroupChildren = mainGroup.children,
      i;
    for (i in mainGroupChildren) {
      if (mainGroupChildren[i].value == groupKey) {
        mainGroupChildren.splice(i, 1);
      }
    }
  }

  var section, key, itemKey;
  if (unquote(group.isa) === "PBXVariantGroup") {
    section = this.hash.project.objects["PBXVariantGroup"];
  } else {
    section = this.hash.project.objects["PBXGroup"];
  }

  removeItemAndCommentFromSectionByUuid(section, groupKey);
};

pbxProject.prototype.addToPbxProjectSection = function (target) {
  var newTarget = {
    value: target.uuid,
    comment: pbxNativeTargetComment(target.pbxNativeTarget),
  };

  this.pbxProjectSection()[this.getFirstProject()["uuid"]]["targets"].push(
    newTarget
  );
};

pbxProject.prototype.addToPbxNativeTargetSection = function (target) {
  var commentKey = f("%s_comment", target.uuid);

  this.pbxNativeTargetSection()[target.uuid] = target.pbxNativeTarget;
  this.pbxNativeTargetSection()[commentKey] = target.pbxNativeTarget.name;
};

pbxProject.prototype.addToPbxFileReferenceSection = function (file) {
  var commentKey = f("%s_comment", file.fileRef);

  this.pbxFileReferenceSection()[file.fileRef] = pbxFileReferenceObj(file);
  this.pbxFileReferenceSection()[commentKey] = pbxFileReferenceComment(file);
};

pbxProject.prototype.removeFromPbxFileReferenceSection = function (file) {
  var i;
  var refObj = pbxFileReferenceObj(file);
  for (i in this.pbxFileReferenceSection()) {
    if (
      this.pbxFileReferenceSection()[i].name == refObj.name ||
      '"' + this.pbxFileReferenceSection()[i].name + '"' == refObj.name ||
      this.pbxFileReferenceSection()[i].path == refObj.path ||
      '"' + this.pbxFileReferenceSection()[i].path + '"' == refObj.path
    ) {
      file.fileRef = file.uuid = i;
      delete this.pbxFileReferenceSection()[i];
      break;
    }
  }
  var commentKey = f("%s_comment", file.fileRef);
  if (this.pbxFileReferenceSection()[commentKey] != undefined) {
    delete this.pbxFileReferenceSection()[commentKey];
  }

  return file;
};

pbxProject.prototype.removeFromPbxFileReferenceSectionByUuid = function (
  fileUuid
) {
  var section = this.pbxFileReferenceSection();

  removeItemAndCommentFromSectionByUuid(section, fileUuid);
};

pbxProject.prototype.addToXcVersionGroupSection = function (file) {
  if (!file.models || !file.currentModel) {
    throw new Error(
      "Cannot create a XCVersionGroup section from not a data model document file"
    );
  }

  var commentKey = f("%s_comment", file.fileRef);

  if (!this.xcVersionGroupSection()[file.fileRef]) {
    this.xcVersionGroupSection()[file.fileRef] = {
      isa: "XCVersionGroup",
      children: file.models.map(function (el) {
        return el.fileRef;
      }),
      currentVersion: file.currentModel.fileRef,
      name: $path.basename(file.path),
      path: file.path,
      sourceTree: '"<group>"',
      versionGroupType: "wrapper.xcdatamodel",
    };
    this.xcVersionGroupSection()[commentKey] = $path.basename(file.path);
  }
};

pbxProject.prototype.addToPluginsPbxGroup = function (file) {
  var pluginsGroup = this.pbxGroupByName("Plugins");
  if (!pluginsGroup) {
    this.addPbxGroup([file.path], "Plugins");
  } else {
    pluginsGroup.children.push(pbxGroupChild(file));
  }
};

pbxProject.prototype.removeFromPluginsPbxGroup = function (file) {
  if (!this.pbxGroupByName("Plugins")) {
    return null;
  }
  var pluginsGroupChildren = this.pbxGroupByName("Plugins").children,
    i;
  for (i in pluginsGroupChildren) {
    if (
      pbxGroupChild(file).value == pluginsGroupChildren[i].value &&
      pbxGroupChild(file).comment == pluginsGroupChildren[i].comment
    ) {
      pluginsGroupChildren.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addToResourcesPbxGroup = function (file) {
  var pluginsGroup = this.pbxGroupByName("Resources");
  if (!pluginsGroup) {
    this.addPbxGroup([file.path], "Resources");
  } else {
    pluginsGroup.children.push(pbxGroupChild(file));
  }
};

pbxProject.prototype.removeFromResourcesPbxGroup = function (file) {
  if (!this.pbxGroupByName("Resources")) {
    return null;
  }
  var pluginsGroupChildren = this.pbxGroupByName("Resources").children,
    i;
  for (i in pluginsGroupChildren) {
    if (
      pbxGroupChild(file).value == pluginsGroupChildren[i].value &&
      pbxGroupChild(file).comment == pluginsGroupChildren[i].comment
    ) {
      pluginsGroupChildren.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addToFrameworksPbxGroup = function (file) {
  var pluginsGroup = this.pbxGroupByName("Frameworks");
  if (!pluginsGroup) {
    this.addPbxGroup([file.path], "Frameworks");
  } else {
    pluginsGroup.children.push(pbxGroupChild(file));
  }
};

pbxProject.prototype.removeFromFrameworksPbxGroup = function (file) {
  if (!this.pbxGroupByName("Frameworks")) {
    return null;
  }
  var pluginsGroupChildren = this.pbxGroupByName("Frameworks").children;

  for (var i in pluginsGroupChildren) {
    if (
      pbxGroupChild(file).value == pluginsGroupChildren[i].value &&
      pbxGroupChild(file).comment == pluginsGroupChildren[i].comment
    ) {
      pluginsGroupChildren.splice(i, 1);
      break;
    }
  }
};

function getReferenceInPbxBuildFile(buildFileReferences, fileReference) {
  var buildFileSection = this.pbxBuildFileSection();
  for (let buildFileReference of buildFileReferences) {
    if (
      buildFileSection[buildFileReference.value] &&
      buildFileSection[buildFileReference.value].fileRef ===
        fileReference.fileRef
    ) {
      return buildFileReference.value;
    }
  }
}

pbxProject.prototype.addToPbxEmbedFrameworksBuildPhase = function (file) {
  var sources = this.pbxEmbedFrameworksBuildPhaseObj(file.target);

  if (sources) {
    var referenceUuid = getReferenceInPbxBuildFile.call(
      this,
      sources.files,
      file
    );
    if (referenceUuid) {
      return referenceUuid;
    }

    sources.files.push(pbxBuildPhaseObj(file));
    return file.uuid;
  }
};

pbxProject.prototype.removeFromPbxEmbedFrameworksBuildPhase = function (file) {
  var sources = this.pbxEmbedFrameworksBuildPhaseObj(file.target);
  if (sources) {
    var files = [];
    for (var i in sources.files) {
      if (sources.files[i].comment != longComment(file)) {
        files.push(sources.files[i]);
      }
    }
    sources.files = files;
  }
};

pbxProject.prototype.addToProductsPbxGroup = function (file) {
  var productsGroup = this.pbxGroupByName("Products");
  if (!productsGroup) {
    this.addPbxGroup([file.path], "Products");
  } else {
    productsGroup.children.push(pbxGroupChild(file));
  }
};

pbxProject.prototype.removeFromProductsPbxGroup = function (file) {
  if (!this.pbxGroupByName("Products")) {
    return null;
  }
  var productsGroupChildren = this.pbxGroupByName("Products").children,
    i;
  for (i in productsGroupChildren) {
    if (
      pbxGroupChild(file).value == productsGroupChildren[i].value &&
      pbxGroupChild(file).comment == productsGroupChildren[i].comment
    ) {
      productsGroupChildren.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addToPbxSourcesBuildPhase = function (file) {
  var sources = this.pbxSourcesBuildPhaseObj(file.target);
  sources.files.push(pbxBuildPhaseObj(file));
};

pbxProject.prototype.removeFromPbxSourcesBuildPhase = function (file) {
  var sources = this.pbxSourcesBuildPhaseObj(file.target),
    i;
  for (i in sources.files) {
    if (sources.files[i].comment == longComment(file)) {
      sources.files.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addToPbxResourcesBuildPhase = function (file) {
  var sources = this.pbxResourcesBuildPhaseObj(file.target);
  sources.files.push(pbxBuildPhaseObj(file));
};

pbxProject.prototype.removeFromPbxResourcesBuildPhase = function (file) {
  var sources = this.pbxResourcesBuildPhaseObj(file.target),
    i;

  for (i in sources.files) {
    if (sources.files[i].comment == longComment(file)) {
      sources.files.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addToPbxFrameworksBuildPhase = function (file) {
  var sources = this.pbxFrameworksBuildPhaseObj(file.target);

  if (sources) {
    var frameworkBuildUuid = getReferenceInPbxBuildFile.call(
      this,
      sources.files,
      file
    );
    if (frameworkBuildUuid) {
      return frameworkBuildUuid;
    }

    sources.files.push(pbxBuildPhaseObj(file));
    return file.uuid;
  }
};

pbxProject.prototype.removeFromPbxFrameworksBuildPhase = function (file) {
  var sources = this.pbxFrameworksBuildPhaseObj(file.target);
  for (var i in sources.files) {
    if (sources.files[i].comment == longComment(file)) {
      sources.files.splice(i, 1);
      break;
    }
  }
};

pbxProject.prototype.addXCConfigurationList = function (
  configurationObjectsArray,
  defaultConfigurationName,
  comment
) {
  var pbxBuildConfigurationSection = this.pbxXCBuildConfigurationSection(),
    pbxXCConfigurationListSection = this.pbxXCConfigurationList(),
    xcConfigurationListUuid = this.generateUuid(),
    commentKey = f("%s_comment", xcConfigurationListUuid),
    xcConfigurationList = {
      isa: "XCConfigurationList",
      buildConfigurations: [],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: defaultConfigurationName,
    };

  for (var index = 0; index < configurationObjectsArray.length; index++) {
    var configuration = configurationObjectsArray[index],
      configurationUuid = this.generateUuid(),
      configurationCommentKey = f("%s_comment", configurationUuid);

    pbxBuildConfigurationSection[configurationUuid] = configuration;
    pbxBuildConfigurationSection[configurationCommentKey] = configuration.name;
    xcConfigurationList.buildConfigurations.push({
      value: configurationUuid,
      comment: configuration.name,
    });
  }

  if (pbxXCConfigurationListSection) {
    pbxXCConfigurationListSection[xcConfigurationListUuid] =
      xcConfigurationList;
    pbxXCConfigurationListSection[commentKey] = comment;
  }

  return {
    uuid: xcConfigurationListUuid,
    xcConfigurationList: xcConfigurationList,
  };
};

pbxProject.prototype.addTargetDependency = function (
  target,
  dependencyTargets
) {
  if (!target) return undefined;

  var nativeTargets = this.pbxNativeTargetSection();

  if (typeof nativeTargets[target] == "undefined")
    throw new Error("Invalid target: " + target);

  for (var index = 0; index < dependencyTargets.length; index++) {
    var dependencyTarget = dependencyTargets[index];
    if (typeof nativeTargets[dependencyTarget] == "undefined")
      throw new Error("Invalid target: " + dependencyTarget);
  }

  var pbxTargetDependency = "PBXTargetDependency",
    pbxContainerItemProxy = "PBXContainerItemProxy",
    pbxTargetDependencySection = this.hash.project.objects[pbxTargetDependency],
    pbxContainerItemProxySection =
      this.hash.project.objects[pbxContainerItemProxy];

  if (!pbxTargetDependencySection) {
    pbxTargetDependencySection = this.hash.project.objects[
      pbxTargetDependency
    ] = {};
  }

  if (!pbxContainerItemProxySection) {
    pbxContainerItemProxySection = this.hash.project.objects[
      pbxContainerItemProxy
    ] = {};
  }

  for (var index = 0; index < dependencyTargets.length; index++) {
    var dependencyTargetUuid = dependencyTargets[index],
      dependencyTargetCommentKey = f("%s_comment", dependencyTargetUuid),
      targetDependencyUuid = this.generateUuid(),
      targetDependencyCommentKey = f("%s_comment", targetDependencyUuid),
      itemProxyUuid = this.generateUuid(),
      itemProxyCommentKey = f("%s_comment", itemProxyUuid),
      itemProxy = {
        isa: pbxContainerItemProxy,
        containerPortal: this.hash.project["rootObject"],
        containerPortal_comment: this.hash.project["rootObject_comment"],
        proxyType: 1,
        remoteGlobalIDString: dependencyTargetUuid,
        remoteInfo: nativeTargets[dependencyTargetUuid].name,
      },
      targetDependency = {
        isa: pbxTargetDependency,
        target: dependencyTargetUuid,
        target_comment: nativeTargets[dependencyTargetCommentKey],
        targetProxy: itemProxyUuid,
        targetProxy_comment: pbxContainerItemProxy,
      };

    if (pbxContainerItemProxySection && pbxTargetDependencySection) {
      pbxContainerItemProxySection[itemProxyUuid] = itemProxy;
      pbxContainerItemProxySection[itemProxyCommentKey] = pbxContainerItemProxy;
      pbxTargetDependencySection[targetDependencyUuid] = targetDependency;
      pbxTargetDependencySection[targetDependencyCommentKey] =
        pbxTargetDependency;
      nativeTargets[target].dependencies.push({
        value: targetDependencyUuid,
        comment: pbxTargetDependency,
      });
    }
  }

  return { uuid: target, target: nativeTargets[target] };
};

pbxProject.prototype.removeBuildPhase = function (comment, target) {
  // Build phase files should be removed separately
  var buildPhaseUuid = undefined,
    buildPhaseTargetUuid = target || this.getFirstTarget().uuid;

  if (
    this.hash.project.objects["PBXNativeTarget"][buildPhaseTargetUuid][
      "buildPhases"
    ]
  ) {
    let phases =
      this.hash.project.objects["PBXNativeTarget"][buildPhaseTargetUuid][
        "buildPhases"
      ];
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      if (phase.comment === comment) {
        buildPhaseUuid = phase.value;
        let commentKey = f("%s_comment", buildPhaseUuid);
        if (this.hash.project.objects["PBXCopyFilesBuildPhase"]) {
          let phase =
            this.hash.project.objects["PBXCopyFilesBuildPhase"][commentKey];
          delete phase;
        }

        if (this.hash.project.objects["PBXShellScriptBuildPhase"]) {
          let phase =
            this.hash.project.objects["PBXShellScriptBuildPhase"][commentKey];
          delete phase;
        }

        phases.splice(i, 1);
      }
    }
  }
};

pbxProject.prototype.addBuildPhase = function (
  filePathsArray,
  buildPhaseType,
  comment,
  target,
  optionsOrFolderType,
  subfolderPath
) {
  var buildPhaseSection,
    fileReferenceSection = this.pbxFileReferenceSection(),
    buildFileSection = this.pbxBuildFileSection(),
    buildPhaseUuid = this.generateUuid(),
    buildPhaseTargetUuid = target || this.getFirstTarget().uuid,
    commentKey = f("%s_comment", buildPhaseUuid),
    buildPhase = {
      isa: buildPhaseType,
      buildActionMask: 2147483647,
      files: [],
      runOnlyForDeploymentPostprocessing: 0,
    },
    filePathToBuildFile = {};

  if (buildPhaseType === "PBXCopyFilesBuildPhase") {
    buildPhase = pbxCopyFilesBuildPhaseObj(
      buildPhase,
      optionsOrFolderType,
      subfolderPath,
      comment
    );
  } else if (buildPhaseType === "PBXShellScriptBuildPhase") {
    buildPhase = pbxShellScriptBuildPhaseObj(
      buildPhase,
      optionsOrFolderType,
      comment
    );
  }

  if (!this.hash.project.objects[buildPhaseType]) {
    this.hash.project.objects[buildPhaseType] = new Object();
  }

  if (!this.hash.project.objects[buildPhaseType][buildPhaseUuid]) {
    this.hash.project.objects[buildPhaseType][buildPhaseUuid] = buildPhase;
    this.hash.project.objects[buildPhaseType][commentKey] = comment;
  }

  if (
    this.hash.project.objects["PBXNativeTarget"][buildPhaseTargetUuid][
      "buildPhases"
    ]
  ) {
    this.hash.project.objects["PBXNativeTarget"][buildPhaseTargetUuid][
      "buildPhases"
    ].push({
      value: buildPhaseUuid,
      comment: comment,
    });
  }

  for (var key in buildFileSection) {
    // only look for comments
    if (!COMMENT_KEY.test(key)) continue;

    var buildFileKey = key.split(COMMENT_KEY)[0],
      buildFile = buildFileSection[buildFileKey],
      fileReference = fileReferenceSection[buildFile.fileRef];

    if (!fileReference) continue;

    var pbxFileObj = new pbxFile(fileReference.path || "");

    filePathToBuildFile[fileReference.path] = {
      uuid: buildFileKey,
      basename: pbxFileObj.basename,
      group: pbxFileObj.group,
    };
  }

  for (var index = 0; index < filePathsArray.length; index++) {
    var filePath = filePathsArray[index],
      filePathQuoted = '"' + filePath + '"',
      file = new pbxFile(filePath);

    if (filePathToBuildFile[filePath]) {
      buildPhase.files.push(pbxBuildPhaseObj(filePathToBuildFile[filePath]));
      continue;
    } else if (filePathToBuildFile[filePathQuoted]) {
      buildPhase.files.push(
        pbxBuildPhaseObj(filePathToBuildFile[filePathQuoted])
      );
      continue;
    }

    file.uuid = this.generateUuid();
    file.fileRef = this.generateUuid();
    this.addToPbxFileReferenceSection(file); // PBXFileReference
    this.addToPbxBuildFileSection(file); // PBXBuildFile
    buildPhase.files.push(pbxBuildPhaseObj(file));
  }

  if (buildPhaseSection) {
    buildPhaseSection[buildPhaseUuid] = buildPhase;
    buildPhaseSection[commentKey] = comment;
  }

  return { uuid: buildPhaseUuid, buildPhase: buildPhase };
};

// helper access functions
pbxProject.prototype.pbxProjectSection = function () {
  return this.hash.project.objects["PBXProject"];
};
pbxProject.prototype.pbxBuildFileSection = function () {
  return this.hash.project.objects["PBXBuildFile"];
};

pbxProject.prototype.pbxXCBuildConfigurationSection = function () {
  return this.hash.project.objects["XCBuildConfiguration"];
};

pbxProject.prototype.pbxFileReferenceSection = function () {
  return this.hash.project.objects["PBXFileReference"];
};

pbxProject.prototype.pbxNativeTargetSection = function () {
  return this.hash.project.objects["PBXNativeTarget"];
};

pbxProject.prototype.xcVersionGroupSection = function () {
  if (typeof this.hash.project.objects["XCVersionGroup"] !== "object") {
    this.hash.project.objects["XCVersionGroup"] = {};
  }

  return this.hash.project.objects["XCVersionGroup"];
};

pbxProject.prototype.pbxXCConfigurationList = function () {
  return this.hash.project.objects["XCConfigurationList"];
};

pbxProject.prototype.pbxGroupByName = function (name) {
  var groups = this.hash.project.objects["PBXGroup"],
    key,
    groupKey;

  for (key in groups) {
    // only look for comments
    if (!COMMENT_KEY.test(key)) continue;

    if (groups[key] == name) {
      groupKey = key.split(COMMENT_KEY)[0];
      groups[groupKey].uuid = groupKey;
      return groups[groupKey];
    }
  }

  return null;
};

pbxProject.prototype.pbxTargetByName = function (name) {
  return this.pbxItemByComment(name, "PBXNativeTarget");
};

pbxProject.prototype.findTargetKey = function (name) {
  var targets = this.hash.project.objects["PBXNativeTarget"];

  for (var key in targets) {
    // only look for comments
    if (COMMENT_KEY.test(key)) continue;

    var target = targets[key];
    if (target.name === name) {
      return key;
    }
  }

  return null;
};

pbxProject.prototype.pbxItemByComment = function (name, pbxSectionName) {
  var section = this.hash.project.objects[pbxSectionName],
    key,
    itemKey;

  for (key in section) {
    // only look for comments
    if (!COMMENT_KEY.test(key)) continue;

    if (section[key] == name) {
      itemKey = key.split(COMMENT_KEY)[0];
      return section[itemKey];
    }
  }

  return null;
};

pbxProject.prototype.pbxSourcesBuildPhaseObj = function (target) {
  return this.buildPhaseObject("PBXSourcesBuildPhase", "Sources", target);
};

pbxProject.prototype.pbxResourcesBuildPhaseObj = function (target) {
  return this.buildPhaseObject("PBXResourcesBuildPhase", "Resources", target);
};

pbxProject.prototype.pbxFrameworksBuildPhaseObj = function (target) {
  return this.buildPhaseObject("PBXFrameworksBuildPhase", "Frameworks", target);
};

pbxProject.prototype.pbxEmbedFrameworksBuildPhaseObj = function (target) {
  return this.buildPhaseObject(
    "PBXCopyFilesBuildPhase",
    "Embed Frameworks",
    target
  );
};

// Find Build Phase from group/target
pbxProject.prototype.buildPhase = function (group, target) {
  if (!target) return undefined;

  var nativeTargets = this.pbxNativeTargetSection();
  if (typeof nativeTargets[target] == "undefined")
    throw new Error("Invalid target: " + target);

  var nativeTarget = nativeTargets[target];
  var buildPhases = nativeTarget.buildPhases;
  for (var i in buildPhases) {
    var buildPhase = buildPhases[i];
    if (buildPhase.comment == group) return buildPhase.value + "_comment";
  }
};

pbxProject.prototype.buildPhaseObject = function (name, group, target) {
  var section = this.hash.project.objects[name],
    obj,
    sectionKey,
    key;
  var buildPhase = this.buildPhase(group, target);

  for (key in section) {
    // only look for comments
    if (!COMMENT_KEY.test(key)) continue;

    // select the proper buildPhase
    if (buildPhase && buildPhase != key) continue;
    if (section[key] == group) {
      sectionKey = key.split(COMMENT_KEY)[0];
      return section[sectionKey];
    }
  }
  return null;
};

pbxProject.prototype.addBuildProperty = function (
  prop,
  value,
  build_name,
  productName
) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    key,
    configuration;

  for (key in configurations) {
    configuration = configurations[key];
    if (
      (!build_name || configuration.name === build_name) &&
      (!productName ||
        configuration.buildSettings.PRODUCT_NAME === productName ||
        configuration.buildSettings.PRODUCT_NAME === `"${productName}"`)
    ) {
      configuration.buildSettings[prop] = value;
    }
  }
};

pbxProject.prototype.removeBuildProperty = function (prop, build_name) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    key,
    configuration;

  for (key in configurations) {
    configuration = configurations[key];
    if (
      (configuration.buildSettings[prop] && !build_name) ||
      configuration.name === build_name
    ) {
      delete configuration.buildSettings[prop];
    }
  }
};

/**
 *
 * @param prop {String}
 * @param value {String|Array|Object|Number|Boolean}
 * @param build {String} Release or Debug
 */
pbxProject.prototype.updateBuildProperty = function (prop, value, build) {
  var configs = this.pbxXCBuildConfigurationSection();
  for (var configName in configs) {
    if (!COMMENT_KEY.test(configName)) {
      var config = configs[configName];
      if ((build && config.name === build) || !build) {
        config.buildSettings[prop] = value;
      }
    }
  }
};

pbxProject.prototype.updateProductName = function (name) {
  this.updateBuildProperty("PRODUCT_NAME", '"' + name + '"');
};

pbxProject.prototype.removeFromFrameworkSearchPaths = function (file) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    SEARCH_PATHS = "FRAMEWORK_SEARCH_PATHS",
    config,
    buildSettings,
    searchPaths;
  var new_path = searchPathForFile(file, this);

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) continue;

    searchPaths = buildSettings[SEARCH_PATHS];

    if (searchPaths && Array.isArray(searchPaths)) {
      var matches = searchPaths.filter(function (p) {
        return p.indexOf(new_path) > -1;
      });
      matches.forEach(function (m) {
        var idx = searchPaths.indexOf(m);
        searchPaths.splice(idx, 1);
      });
    }
  }
};

pbxProject.prototype.addToFrameworkSearchPaths = function (file) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    config,
    buildSettings,
    searchPaths;

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) continue;

    if (
      !buildSettings["FRAMEWORK_SEARCH_PATHS"] ||
      buildSettings["FRAMEWORK_SEARCH_PATHS"] === INHERITED
    ) {
      buildSettings["FRAMEWORK_SEARCH_PATHS"] = [INHERITED];
    }
    var searchPath = searchPathForFile(file, this);
    if (buildSettings["FRAMEWORK_SEARCH_PATHS"].indexOf(searchPath) < 0) {
      buildSettings["FRAMEWORK_SEARCH_PATHS"].push(searchPath);
    }
  }
};

pbxProject.prototype.removeFromLibrarySearchPaths = function (file) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    SEARCH_PATHS = "LIBRARY_SEARCH_PATHS",
    config,
    buildSettings,
    searchPaths;
  var new_path = searchPathForFile(file, this);

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) continue;

    searchPaths = buildSettings[SEARCH_PATHS];

    if (searchPaths && Array.isArray(searchPaths)) {
      var matches = searchPaths.filter(function (p) {
        return p.indexOf(new_path) > -1;
      });
      matches.forEach(function (m) {
        var idx = searchPaths.indexOf(m);
        searchPaths.splice(idx, 1);
      });
    }
  }
};

pbxProject.prototype.addToLibrarySearchPaths = function (file) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    config,
    buildSettings,
    searchPaths;

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) continue;

    if (
      !buildSettings["LIBRARY_SEARCH_PATHS"] ||
      buildSettings["LIBRARY_SEARCH_PATHS"] === INHERITED
    ) {
      buildSettings["LIBRARY_SEARCH_PATHS"] = [INHERITED];
    }

    buildSettings["LIBRARY_SEARCH_PATHS"].push(searchPathForFile(file, this));
  }
};

pbxProject.prototype.removeFromHeaderSearchPaths = function (file) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    SEARCH_PATHS = "HEADER_SEARCH_PATHS",
    config,
    buildSettings,
    searchPaths;
  var new_path = searchPathForFile(file, this);

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) continue;

    if (buildSettings[SEARCH_PATHS]) {
      var matches = buildSettings[SEARCH_PATHS].filter(function (p) {
        return p.indexOf(new_path) > -1;
      });
      matches.forEach(function (m) {
        var idx = buildSettings[SEARCH_PATHS].indexOf(m);
        buildSettings[SEARCH_PATHS].splice(idx, 1);
      });
    }
  }
};
pbxProject.prototype.addToHeaderSearchPaths = function (file, productName) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    config,
    buildSettings,
    searchPaths;

  productName = unquote(productName || this.productName);

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != productName) continue;

    if (!buildSettings["HEADER_SEARCH_PATHS"]) {
      buildSettings["HEADER_SEARCH_PATHS"] = [INHERITED];
    }

    buildSettings["HEADER_SEARCH_PATHS"].push(searchPathForFile(file, this));
  }
};

pbxProject.prototype.addToOtherLinkerFlags = function (flag) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    INHERITED = '"$(inherited)"',
    OTHER_LDFLAGS = "OTHER_LDFLAGS",
    config,
    buildSettings;

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) continue;

    if (
      !buildSettings[OTHER_LDFLAGS] ||
      buildSettings[OTHER_LDFLAGS] === INHERITED
    ) {
      buildSettings[OTHER_LDFLAGS] = [INHERITED];
    }

    buildSettings[OTHER_LDFLAGS].push(flag);
  }
};

pbxProject.prototype.removeFromOtherLinkerFlags = function (flag) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    OTHER_LDFLAGS = "OTHER_LDFLAGS",
    config,
    buildSettings;

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (unquote(buildSettings["PRODUCT_NAME"]) != this.productName) {
      continue;
    }

    if (buildSettings[OTHER_LDFLAGS]) {
      var matches = buildSettings[OTHER_LDFLAGS].filter(function (p) {
        return p.indexOf(flag) > -1;
      });
      matches.forEach(function (m) {
        var idx = buildSettings[OTHER_LDFLAGS].indexOf(m);
        buildSettings[OTHER_LDFLAGS].splice(idx, 1);
      });
    }
  }
};

pbxProject.prototype.addToBuildSettings = function (
  buildSetting,
  value,
  targetUuid
) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    buildConfigurationsUuids = [],
    config,
    buildSettings;

  if (targetUuid) {
    var targets = this.hash.project.objects["PBXNativeTarget"] || [];
    var target = targets[targetUuid] || {};
    var buildConfigurationList = target["buildConfigurationList"];
    var pbxXCConfigurationListSection = this.pbxXCConfigurationList() || {};
    var xcConfigurationList =
      pbxXCConfigurationListSection[buildConfigurationList] || {};
    var buildConfigurations = xcConfigurationList.buildConfigurations || [];
    for (var configurationUuid in buildConfigurations) {
      buildConfigurationsUuids.push(
        buildConfigurations[configurationUuid].value
      );
    }
  }

  for (config in configurations) {
    if (!target || buildConfigurationsUuids.indexOf(config) >= 0) {
      buildSettings = configurations[config].buildSettings;

      buildSettings[buildSetting] = value;
    }
  }
};

pbxProject.prototype.removeFromBuildSettings = function (buildSetting) {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    config,
    buildSettings;

  for (config in configurations) {
    buildSettings = configurations[config].buildSettings;

    if (buildSettings[buildSetting]) {
      delete buildSettings[buildSetting];
    }
  }
};

// a JS getter. hmmm
pbxProject.prototype.__defineGetter__("productName", function () {
  var configurations = nonComments(this.pbxXCBuildConfigurationSection()),
    config,
    productName;

  for (config in configurations) {
    productName = configurations[config].buildSettings["PRODUCT_NAME"];

    if (productName) {
      return unquote(productName);
    }
  }
});

// check if file is present
pbxProject.prototype.hasFile = function (filePath) {
  var files = nonComments(this.pbxFileReferenceSection()),
    file,
    id;
  for (id in files) {
    file = files[id];
    if (file.path == filePath || file.path == '"' + filePath + '"') {
      return file;
    }
  }

  return false;
};

pbxProject.prototype.getFileKey = function (filePath) {
  var files = nonComments(this.pbxFileReferenceSection()),
    file,
    id;
  for (id in files) {
    file = files[id];
    if (file.path == filePath || file.path == '"' + filePath + '"') {
      return id;
    }
  }

  return false;
};

pbxProject.prototype.addTarget = function (
  name,
  type,
  subfolder,
  parentTarget
) {
  // Setup uuid and name of new target
  var targetUuid = this.generateUuid(),
    targetType = type,
    targetSubfolder = subfolder || name,
    targetName = name.trim();

  // Check type against list of allowed target types
  if (!targetName) {
    throw new Error("Target name missing.");
  }

  // Check type against list of allowed target types
  if (!targetType) {
    throw new Error("Target type missing.");
  }

  // Check type against list of allowed target types
  if (!producttypeForTargettype(targetType)) {
    throw new Error("Target type invalid: " + targetType);
  }

  // Build Configuration: Create
  var buildConfigurationsList = [
    {
      name: "Debug",
      isa: "XCBuildConfiguration",
      buildSettings: {
        GCC_PREPROCESSOR_DEFINITIONS: ['"DEBUG=1"', '"$(inherited)"'],
        INFOPLIST_FILE: '"' + $path.join(targetSubfolder, "Info.plist" + '"'),
        LD_RUNPATH_SEARCH_PATHS:
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        PRODUCT_NAME: '"' + targetName + '"',
        SKIP_INSTALL: "YES",
      },
    },
    {
      name: "Release",
      isa: "XCBuildConfiguration",
      buildSettings: {
        INFOPLIST_FILE: '"' + $path.join(targetSubfolder, "Info.plist" + '"'),
        LD_RUNPATH_SEARCH_PATHS:
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        PRODUCT_NAME: '"' + targetName + '"',
        SKIP_INSTALL: "YES",
      },
    },
  ];

  // Build Configuration: Add
  var buildConfigurations = this.addXCConfigurationList(
    buildConfigurationsList,
    "Release",
    'Build configuration list for PBXNativeTarget "' + targetName + '"'
  );

  // Product: Create
  var productName = targetName,
    productType = producttypeForTargettype(targetType),
    productFileType = filetypeForProducttype(productType),
    productFile = this.addProductFile(productName, {
      group: "Copy Files",
      target: targetUuid,
      explicitFileType: productFileType,
    }),
    productFileName = productFile.basename;

  // Product: Add to build file list
  this.addToPbxBuildFileSection(productFile);

  // Target: Create
  var target = {
    uuid: targetUuid,
    pbxNativeTarget: {
      isa: "PBXNativeTarget",
      name: '"' + targetName + '"',
      productName: '"' + targetName + '"',
      productReference: productFile.fileRef,
      productType: '"' + producttypeForTargettype(targetType) + '"',
      buildConfigurationList: buildConfigurations.uuid,
      buildPhases: [],
      buildRules: [],
      dependencies: [],
    },
  };

  // Target: Add to PBXNativeTarget section
  this.addToPbxNativeTargetSection(target);

  if (
    targetType === "app_extension" ||
    targetType === "watch_extension" ||
    targetType === "watch_app"
  ) {
    const isWatchApp = targetType === "watch_app";
    const copyTargetUuid = parentTarget || this.getFirstTarget().uuid;
    const phaseComment =
      targetType === "watch_app" ? "Embed Watch Content" : "Copy Files";
    let destination;

    if (isWatchApp) {
      destination = '"$(CONTENTS_FOLDER_PATH)/Watch"';
    }

    // Create CopyFiles phase in parent target
    this.addBuildPhase(
      [],
      "PBXCopyFilesBuildPhase",
      phaseComment,
      copyTargetUuid,
      targetType,
      destination
    );

    // Add product to CopyFiles phase
    this.addToPbxCopyfilesBuildPhase(productFile, phaseComment, copyTargetUuid);
  }

  // Target: Add uuid to root project
  this.addToPbxProjectSection(target);

  // Target: Add dependency for this target to first (main) target
  this.addTargetDependency(parentTarget || this.getFirstTarget().uuid, [
    target.uuid,
  ]);

  // Return target on success
  return target;
};

pbxProject.prototype.removeTargetsByProductType = function (targetProductType) {
  var nativeTargetsNonComments = nonComments(this.pbxNativeTargetSection());

  for (var nativeTargetUuid in nativeTargetsNonComments) {
    var target = nativeTargetsNonComments[nativeTargetUuid];
    if (
      target.productType === targetProductType ||
      target.productType === `"${targetProductType}"`
    ) {
      this.removeTarget(target, nativeTargetUuid);
    }
  }
};

pbxProject.prototype.removeTarget = function (target, targetKey) {
  let files = [];
  var pbxBuildFileSection = this.pbxBuildFileSection();
  var fileReferenceSection = this.pbxFileReferenceSection();

  // iterate all buildPhases and collect all files that should be removed
  // remove the phase from the appropriate section
  var buildPhases = target["buildPhases"];

  for (let i = 0; i < buildPhases.length; i++) {
    var buildPhase = buildPhases[i];
    var sectionUuid = buildPhase.value;
    var section = {}; //in case we don't recognise the section
    if (buildPhase.comment === buildPhaseNameForIsa("PBXSourcesBuildPhase")) {
      section = this.hash.project.objects["PBXSourcesBuildPhase"];
      files = files.concat(section[sectionUuid].files);
    } else if (
      buildPhase.comment === buildPhaseNameForIsa("PBXResourcesBuildPhase")
    ) {
      section = this.hash.project.objects["PBXResourcesBuildPhase"];
      files = files.concat(section[sectionUuid].files);
    } else if (
      buildPhase.comment === buildPhaseNameForIsa("PBXFrameworksBuildPhase")
    ) {
      section = this.hash.project.objects["PBXFrameworksBuildPhase"];
      var frameworkFiles = section[sectionUuid].files;
      for (let currentBuildFile of frameworkFiles) {
        var currentBuildFileUuid = currentBuildFile.value;
        var fileRef = pbxBuildFileSection[currentBuildFileUuid].fileRef;
        var stillReferenced = false;
        for (var buildFileUuid in nonComments(pbxBuildFileSection)) {
          if (
            pbxBuildFileSection[buildFileUuid].fileRef === fileRef &&
            buildFileUuid !== currentBuildFileUuid
          ) {
            stillReferenced = true;
            break;
          }
        }

        if (!stillReferenced) {
          var frameworkFileRef = fileReferenceSection[fileRef];
          var fileToRemove = new pbxFile(unquote(frameworkFileRef.path), {
            basename: frameworkFileRef.name,
          });
          fileToRemove.fileRef = fileRef;
          this.removeFromFrameworksPbxGroup(fileToRemove);
          removeItemAndCommentFromSectionByUuid(fileReferenceSection, fileRef);
        }
      }
      files = files.concat(frameworkFiles);
    }

    removeItemAndCommentFromSectionByUuid(section, sectionUuid);
  }

  //remove files from all build phases from PBXBuildFile section
  for (let k = 0; k < files.length; k++) {
    const fileUuid = files[k].value;
    this.removeFromPbxBuildFileSectionByUuid(fileUuid);
  }

  //remove target from the project itself
  var targets =
    this.pbxProjectSection()[this.getFirstProject()["uuid"]]["targets"];
  for (let l = 0; l < targets.length; l++) {
    if (targets[l].value === targetKey) {
      targets.splice(l, 1);
    }
  }

  //remove target build configurations
  //get configurationList object and get all configuration uuids
  var buildConfigurationList = target["buildConfigurationList"];
  var pbxXCConfigurationListSection = this.pbxXCConfigurationList();
  var xcConfigurationList =
    pbxXCConfigurationListSection[buildConfigurationList] || {};
  var buildConfigurations = xcConfigurationList.buildConfigurations || [];

  //remove all configurations from XCBuildConfiguration section
  var pbxBuildConfigurationSection = this.pbxXCBuildConfigurationSection();
  for (let m = 0; m < buildConfigurations.length; m++) {
    const configuration = buildConfigurations[m];
    removeItemAndCommentFromSectionByUuid(
      pbxBuildConfigurationSection,
      configuration.value
    );
  }

  //remove the XCConfigurationList from the section
  removeItemAndCommentFromSectionByUuid(
    pbxXCConfigurationListSection,
    buildConfigurationList
  );

  //get target product information
  var productUuid = "";

  var productReferenceUuid = target.productReference;

  // the productReference is the uuid from the PBXFileReference Section, but we need the one in PBXBuildFile section
  // check the fileRef of all records until we find the product
  for (var uuid in nonComments(pbxBuildFileSection)) {
    if (this.pbxBuildFileSection()[uuid].fileRef == productReferenceUuid) {
      productUuid = uuid;
    }
  }

  //remove copy phase
  var pbxCopySection = this.hash.project.objects["PBXCopyFilesBuildPhase"];
  var noCommentsCopySection = nonComments(pbxCopySection);
  for (var copyPhaseId in noCommentsCopySection) {
    var copyPhase = noCommentsCopySection[copyPhaseId];
    if (copyPhase.files) {
      //check if the product of the target is part of this copy phase files
      for (let p = 0; p < copyPhase.files.length; p++) {
        const copyFile = copyPhase.files[p];
        if (copyFile.value === productUuid) {
          //if this is the only file in the copy phase - delete the whole phase and remove it from all targets
          if (copyPhase.files.length === 1) {
            var nativeTargetsnoComments = nonComments(
              this.pbxNativeTargetSection()
            );
            for (var nativeTargetUuid in nativeTargetsnoComments) {
              const nativeTarget = nativeTargetsnoComments[nativeTargetUuid];
              for (var phaseIndex in nativeTarget.buildPhases) {
                if (nativeTarget.buildPhases[phaseIndex].value == copyPhaseId) {
                  //remove copy build phase from containing target
                  nativeTarget.buildPhases.splice(phaseIndex, 1);
                  break;
                }
              }
            }

            //remove from copySection
            removeItemAndCommentFromSectionByUuid(pbxCopySection, copyPhaseId);
          } else {
            //if there are other files in the copy phase, just remove the product
            copyPhase.files.splice(p, 1);
          }
          break;
        }
      }
    }
  }

  //remove the product from the PBXBuildFile section
  removeItemAndCommentFromSectionByUuid(pbxBuildFileSection, productUuid);

  //remove the product from the Products PBXGroup
  var productReference = fileReferenceSection[productReferenceUuid];
  var productFile = new pbxFile(productReference.path);
  productFile.fileRef = productReferenceUuid;
  productFile.uuid = productReferenceUuid;
  this.removeFromProductsPbxGroup(productFile);

  //remove the product from the PBXFileReference section
  removeItemAndCommentFromSectionByUuid(
    fileReferenceSection,
    productReferenceUuid
  );

  //find all PBXTargetDependency that refer the target and remove them with the PBXContainerItemProxy
  var pbxTargetDependency = "PBXTargetDependency";
  var pbxContainerItemProxy = "PBXContainerItemProxy";
  var pbxTargetDependencySection =
    this.hash.project.objects[pbxTargetDependency];
  var pbxTargetDependencySectionNoComments = nonComments(
    pbxTargetDependencySection
  );
  var pbxContainerItemProxySection =
    this.hash.project.objects[pbxContainerItemProxy];

  for (var targetDependencyUuid in pbxTargetDependencySectionNoComments) {
    var targetDependency =
      pbxTargetDependencySectionNoComments[targetDependencyUuid];
    if (targetDependency.target === targetKey) {
      //remove the PBXContainerItemProxy
      removeItemAndCommentFromSectionByUuid(
        pbxContainerItemProxySection,
        targetDependency.targetProxy
      );
      //remove the PBXTargetDependency from dependencies from all targets
      for (var nativeTargetKey in nativeTargetsnoComments) {
        const nativeTarget = nativeTargetsnoComments[nativeTargetKey];
        for (var dependencyIndex in nativeTarget.dependencies) {
          if (
            nativeTarget.dependencies[dependencyIndex].value ==
            targetDependencyUuid
          ) {
            nativeTarget.dependencies.splice(dependencyIndex, 1);
          }
        }
      }
      //remove the PBXTargetDependency
      removeItemAndCommentFromSectionByUuid(
        pbxTargetDependencySection,
        targetDependencyUuid
      );
    }
  }

  //remove targetAttributes for target
  var attributes = this.getFirstProject()["firstProject"]["attributes"];
  if (attributes["TargetAttributes"]) {
    delete attributes["TargetAttributes"][targetKey];
  }

  //remove the target from PBXNativeTarget section
  var nativeTargets = this.pbxNativeTargetSection();
  removeItemAndCommentFromSectionByUuid(nativeTargets, targetKey);

  this.removePbxGroup(unquote(target.name));
};

function removeItemAndCommentFromSectionByUuid(section, itemUuid) {
  var commentKey = f("%s_comment", itemUuid);
  delete section[commentKey];
  delete section[itemUuid];
}

// helper recursive prop search+replace
function propReplace(obj, prop, value) {
  var o = {};
  for (var p in obj) {
    if (o.hasOwnProperty.call(obj, p)) {
      if (typeof obj[p] == "object" && !Array.isArray(obj[p])) {
        propReplace(obj[p], prop, value);
      } else if (p == prop) {
        obj[p] = value;
      }
    }
  }
}

// helper object creation functions
function pbxBuildFileObj(file) {
  var obj = Object.create(null);

  obj.isa = "PBXBuildFile";
  obj.fileRef = file.fileRef;
  obj.fileRef_comment = file.basename;
  if (file.settings) obj.settings = file.settings;

  return obj;
}

function pbxFileReferenceObj(file) {
  var fileObject = {
    isa: "PBXFileReference",
    name: file.basename,
    path: file.path,
    sourceTree: file.sourceTree,
    fileEncoding: file.fileEncoding,
    lastKnownFileType: file.lastKnownFileType,
    explicitFileType: file.explicitFileType,
    includeInIndex: file.includeInIndex,
  };

  if (fileObject.name && fileObject.name.indexOf('"') !== -1) {
    fileObject.name = fileObject.name.replace(/\"/g, '\\"');
    fileObject.path = fileObject.path.replace(/\"/g, '\\"');
  }

  if (file.basename && !file.basename.match(NO_SPECIAL_SYMBOLS)) {
    fileObject.name = '"' + fileObject.name + '"';
  }

  if (!file.path.match(NO_SPECIAL_SYMBOLS)) {
    fileObject.path = '"' + fileObject.path + '"';
  }

  return fileObject;
}

function pbxBuildPhaseObj(file) {
  var obj = Object.create(null);

  obj.value = file.uuid;
  obj.comment = longComment(file);

  return obj;
}

function pbxCopyFilesBuildPhaseObj(obj, folderType, subfolderPath, phaseName) {
  // Add additional properties for 'CopyFiles' build phase
  var DESTINATION_BY_TARGETTYPE = {
    application: "wrapper",
    app_extension: "plugins",
    bundle: "wrapper",
    command_line_tool: "wrapper",
    dynamic_library: "products_directory",
    framework: "shared_frameworks",
    frameworks: "frameworks",
    static_library: "products_directory",
    unit_test_bundle: "wrapper",
    watch_app: "products_directory",
    watch_extension: "plugins",
  };
  var SUBFOLDERSPEC_BY_DESTINATION = {
    absolute_path: 0,
    executables: 6,
    frameworks: 10,
    java_resources: 15,
    plugins: 13,
    products_directory: 16,
    resources: 7,
    shared_frameworks: 11,
    shared_support: 12,
    wrapper: 1,
    xpc_services: 0,
  };

  obj.name = '"' + phaseName + '"';
  obj.dstPath = subfolderPath || '""';
  obj.dstSubfolderSpec =
    SUBFOLDERSPEC_BY_DESTINATION[DESTINATION_BY_TARGETTYPE[folderType]];

  return obj;
}

function pbxShellScriptBuildPhaseObj(obj, options, phaseName) {
  obj.name = '"' + phaseName + '"';
  obj.inputPaths = options.inputPaths || [];
  obj.outputPaths = options.outputPaths || [];
  obj.shellPath = options.shellPath;
  obj.shellScript = '"' + options.shellScript.replace(/"/g, '\\"') + '"';

  return obj;
}

function pbxBuildFileComment(file) {
  return longComment(file);
}

function pbxFileReferenceComment(file) {
  return file.basename || $path.basename(file.path);
}

function pbxNativeTargetComment(target) {
  return target.name;
}

function longComment(file) {
  return f("%s in %s", file.basename, file.group);
}

// respect <group> path
function correctForPluginsPath(file, project) {
  return correctForPath(file, project, "Plugins");
}

function correctForResourcesPath(file, project) {
  return correctForPath(file, project, "Resources");
}

function correctForFrameworksPath(file, project) {
  return correctForPath(file, project, "Frameworks");
}

function correctForPath(file, project, group) {
  var r_group_dir = new RegExp("^" + group + "[\\\\/]");

  if (project.pbxGroupByName(group)?.path)
    file.path = file.path.replace(r_group_dir, "");

  return file;
}

function searchPathForFile(file, proj) {
  const getPathString = (filePath) => {
    return `"\\"${filePath}\\""`;
  };

  const getRelativePathString = (filePath) => {
    return getPathString(`$(SRCROOT)/${filePath}`);
  };

  if (typeof file === "string") {
    let relativeFilePath = file;

    if ($path.isAbsolute(file)) {
      const srcRoot = $path.dirname($path.dirname(proj.filepath));
      relativeFilePath = $path.relative(srcRoot, file);
    }

    return getRelativePathString(relativeFilePath);
  }

  if (file.relativePath) {
    return getRelativePathString(file.relativePath);
  }

  var plugins = proj.pbxGroupByName("Plugins"),
    pluginsPath = plugins ? plugins.path : null,
    fileDir = $path.dirname(file.path);

  if (fileDir == ".") {
    fileDir = "";
  } else {
    fileDir = "/" + fileDir;
  }

  if (file.plugin && pluginsPath) {
    return getRelativePathString(unquote(pluginsPath));
  } else if (file.customFramework && file.dirname) {
    return getPathString(file.dirname);
  } else {
    return getRelativePathString(proj.productName + fileDir);
  }
}

function nonComments(obj) {
  var keys = Object.keys(obj),
    newObj = {},
    i = 0;

  for (i; i < keys.length; i++) {
    if (!COMMENT_KEY.test(keys[i])) {
      newObj[keys[i]] = obj[keys[i]];
    }
  }

  return newObj;
}

function unquote(str) {
  if (str) return str.replace(/^"(.*)"$/, "$1");
}

function buildPhaseNameForIsa(isa) {
  var BUILDPHASENAME_BY_ISA = {
    PBXCopyFilesBuildPhase: "Copy Files",
    PBXResourcesBuildPhase: "Resources",
    PBXSourcesBuildPhase: "Sources",
    PBXFrameworksBuildPhase: "Frameworks",
  };

  return BUILDPHASENAME_BY_ISA[isa];
}

function producttypeForTargettype(targetType) {
  var PRODUCTTYPE_BY_TARGETTYPE = {
    application: "com.apple.product-type.application",
    app_extension: "com.apple.product-type.app-extension",
    bundle: "com.apple.product-type.bundle",
    command_line_tool: "com.apple.product-type.tool",
    dynamic_library: "com.apple.product-type.library.dynamic",
    framework: "com.apple.product-type.framework",
    static_library: "com.apple.product-type.library.static",
    unit_test_bundle: "com.apple.product-type.bundle.unit-test",
    watch_app: "com.apple.product-type.application.watchapp2",
    watch_extension: "com.apple.product-type.watchkit2-extension",
  };

  return PRODUCTTYPE_BY_TARGETTYPE[targetType];
}

function filetypeForProducttype(productType) {
  var FILETYPE_BY_PRODUCTTYPE = {
    "com.apple.product-type.application": '"wrapper.application"',
    "com.apple.product-type.app-extension": '"wrapper.app-extension"',
    "com.apple.product-type.bundle": '"wrapper.plug-in"',
    "com.apple.product-type.tool": '"compiled.mach-o.dylib"',
    "com.apple.product-type.library.dynamic": '"compiled.mach-o.dylib"',
    "com.apple.product-type.framework": '"wrapper.framework"',
    "com.apple.product-type.library.static": '"archive.ar"',
    "com.apple.product-type.bundle.unit-test": '"wrapper.cfbundle"',
    "com.apple.product-type.application.watchapp2": '"wrapper.application"',
    "com.apple.product-type.watchkit2-extension": '"wrapper.app-extension"',
  };

  return FILETYPE_BY_PRODUCTTYPE[productType];
}

pbxProject.prototype.getFirstProject = function () {
  // Get pbxProject container
  var pbxProjectContainer = this.pbxProjectSection();

  // Get first pbxProject UUID
  var firstProjectUuid = Object.keys(pbxProjectContainer)[0];

  // Get first pbxProject
  var firstProject = pbxProjectContainer[firstProjectUuid];

  return {
    uuid: firstProjectUuid,
    firstProject: firstProject,
  };
};

pbxProject.prototype.getFirstTarget = function () {
  // Get first targets UUID
  var firstTargetUuid =
    this.getFirstProject()["firstProject"]["targets"][0].value;

  // Get first pbxNativeTarget
  var firstTarget = this.pbxNativeTargetSection()[firstTargetUuid];

  return {
    uuid: firstTargetUuid,
    firstTarget: firstTarget,
  };
};

/*** NEW ***/

pbxProject.prototype.addToPbxGroupType = function (file, groupKey, groupType) {
  var group = this.getPBXGroupByKeyAndType(groupKey, groupType);

  if (group && group.children !== undefined) {
    if (typeof file === "string") {
      //Group Key
      var childGroup = {
        value: file,
      };
      if (this.getPBXGroupByKey(file)) {
        childGroup.comment = this.getPBXGroupByKey(file).name;
      } else if (this.getPBXVariantGroupByKey(file)) {
        childGroup.comment = this.getPBXVariantGroupByKey(file).name;
      }

      group.children.push(childGroup);
    } else {
      //File Object
      group.children.push(pbxGroupChild(file));
    }
  }
};

pbxProject.prototype.addToPbxVariantGroup = function (file, groupKey) {
  this.addToPbxGroupType(file, groupKey, "PBXVariantGroup");
};

pbxProject.prototype.addToPbxGroup = function (file, groupKey) {
  this.addToPbxGroupType(file, groupKey, "PBXGroup");
};

pbxProject.prototype.pbxCreateGroupWithType = function (
  name,
  pathName,
  groupType
) {
  //Create object
  var model = {
    isa: '"' + groupType + '"',
    children: [],
    name: name,
    sourceTree: '"<group>"',
  };
  if (pathName) model.path = pathName;
  var key = this.generateUuid();

  //Create comment
  var commendId = key + "_comment";

  //add obj and commentObj to groups;
  var groups = this.hash.project.objects[groupType];
  if (!groups) {
    groups = this.hash.project.objects[groupType] = new Object();
  }
  groups[commendId] = name;
  groups[key] = model;

  return key;
};

pbxProject.prototype.pbxCreateVariantGroup = function (name) {
  return this.pbxCreateGroupWithType(name, undefined, "PBXVariantGroup");
};

pbxProject.prototype.pbxCreateGroup = function (name, pathName) {
  return this.pbxCreateGroupWithType(name, pathName, "PBXGroup");
};

pbxProject.prototype.removeFromPbxGroupAndType = function (
  file,
  groupKey,
  groupType
) {
  var group = this.getPBXGroupByKeyAndType(groupKey, groupType);
  if (group) {
    var groupChildren = group.children,
      i;
    for (i in groupChildren) {
      if (
        pbxGroupChild(file).value == groupChildren[i].value &&
        pbxGroupChild(file).comment == groupChildren[i].comment
      ) {
        groupChildren.splice(i, 1);
        break;
      }
    }
  }
};

pbxProject.prototype.removeFromPbxGroup = function (file, groupKey) {
  this.removeFromPbxGroupAndType(file, groupKey, "PBXGroup");
};

pbxProject.prototype.removeFromPbxVariantGroup = function (file, groupKey) {
  this.removeFromPbxGroupAndType(file, groupKey, "PBXVariantGroup");
};

pbxProject.prototype.getPBXGroupByKeyAndType = function (key, groupType) {
  return this.hash.project.objects[groupType][key];
};

pbxProject.prototype.getPBXGroupByKey = function (key) {
  return this.hash.project.objects["PBXGroup"][key];
};

pbxProject.prototype.getPBXVariantGroupByKey = function (key) {
  return this.hash.project.objects["PBXVariantGroup"][key];
};

pbxProject.prototype.findPBXGroupKeyAndType = function (criteria, groupType) {
  var groups = this.hash.project.objects[groupType];
  var target;

  for (var key in groups) {
    // only look for comments
    if (COMMENT_KEY.test(key)) continue;

    var group = groups[key];
    if (criteria && criteria.path && criteria.name) {
      if (
        criteria.path === group.path &&
        (criteria.name === group.name || `"${criteria.name}"` === group.name)
      ) {
        target = key;
        break;
      }
    } else if (criteria && criteria.path) {
      if (criteria.path === group.path) {
        target = key;
        break;
      }
    } else if (criteria && criteria.name) {
      if (criteria.name === group.name || `"${criteria.name}"` === group.name) {
        target = key;
        break;
      }
    }
  }

  return target;
};

pbxProject.prototype.findPBXGroupKey = function (criteria) {
  return this.findPBXGroupKeyAndType(criteria, "PBXGroup");
};

pbxProject.prototype.findPBXVariantGroupKey = function (criteria) {
  return this.findPBXGroupKeyAndType(criteria, "PBXVariantGroup");
};

pbxProject.prototype.addLocalizationVariantGroup = function (name, ops) {
  ops = ops || {};
  var groupKey = this.pbxCreateVariantGroup(name);

  if (!ops.skipAddToResourcesGroup) {
    var resourcesGroupKey = this.findPBXGroupKey({ name: "Resources" });
    this.addToPbxGroup(groupKey, resourcesGroupKey);
  }

  var localizationVariantGroup = {
    uuid: this.generateUuid(),
    fileRef: groupKey,
    basename: name,
    group: "Resources",
    children: [],
  };
  if (ops.target) {
    localizationVariantGroup.target = ops.target;
  }
  this.addToPbxBuildFileSection(localizationVariantGroup); // PBXBuildFile
  this.addToPbxResourcesBuildPhase(localizationVariantGroup); //PBXResourcesBuildPhase

  return localizationVariantGroup;
};

pbxProject.prototype.addKnownRegion = function (name) {
  if (
    !this.pbxProjectSection()[this.getFirstProject()["uuid"]]["knownRegions"]
  ) {
    this.pbxProjectSection()[this.getFirstProject()["uuid"]]["knownRegions"] =
      [];
  }
  if (!this.hasKnownRegion(name)) {
    this.pbxProjectSection()[this.getFirstProject()["uuid"]][
      "knownRegions"
    ].push(name);
  }
};

pbxProject.prototype.removeKnownRegion = function (name) {
  var regions =
    this.pbxProjectSection()[this.getFirstProject()["uuid"]]["knownRegions"];
  if (regions) {
    for (var i = 0; i < regions.length; i++) {
      if (regions[i] === name) {
        regions.splice(i, 1);
        break;
      }
    }
    this.pbxProjectSection()[this.getFirstProject()["uuid"]]["knownRegions"] =
      regions;
  }
};

pbxProject.prototype.hasKnownRegion = function (name) {
  var regions =
    this.pbxProjectSection()[this.getFirstProject()["uuid"]]["knownRegions"];
  if (regions) {
    for (var i in regions) {
      if (regions[i] === name) {
        return true;
      }
    }
  }
  return false;
};

pbxProject.prototype.getPBXObject = function (name) {
  return this.hash.project.objects[name];
};

pbxProject.prototype.addFile = function (path, group, opt) {
  var file = new pbxFile(path, opt);

  // null is better for early errors
  if (this.hasFile(file.path)) return null;

  file.fileRef = this.generateUuid();

  this.addToPbxFileReferenceSection(file); // PBXFileReference

  if (this.getPBXGroupByKey(group)) {
    this.addToPbxGroup(file, group); // PBXGroup
  } else if (this.getPBXVariantGroupByKey(group)) {
    this.addToPbxVariantGroup(file, group); // PBXVariantGroup
  }

  return file;
};

pbxProject.prototype.removeFile = function (path, group, opt) {
  var file = new pbxFile(path, opt);

  this.removeFromPbxFileReferenceSection(file); // PBXFileReference

  if (this.getPBXGroupByKey(group)) {
    this.removeFromPbxGroup(file, group); // PBXGroup
  } else if (this.getPBXVariantGroupByKey(group)) {
    this.removeFromPbxVariantGroup(file, group); // PBXVariantGroup
  }

  return file;
};

pbxProject.prototype.getBuildProperty = function (prop, build) {
  var target;
  var configs = this.pbxXCBuildConfigurationSection();
  for (var configName in configs) {
    if (!COMMENT_KEY.test(configName)) {
      var config = configs[configName];
      if ((build && config.name === build) || build === undefined) {
        if (config.buildSettings[prop] !== undefined) {
          target = config.buildSettings[prop];
        }
      }
    }
  }
  return target;
};

pbxProject.prototype.getBuildConfigByName = function (name) {
  var target = {};
  var configs = this.pbxXCBuildConfigurationSection();
  for (var configName in configs) {
    if (!COMMENT_KEY.test(configName)) {
      var config = configs[configName];
      if (config.name === name) {
        target[configName] = config;
      }
    }
  }
  return target;
};

pbxProject.prototype.addDataModelDocument = function (filePath, group, opt) {
  if (!group) {
    group = "Resources";
  }
  if (!this.getPBXGroupByKey(group)) {
    group = this.findPBXGroupKey({ name: group });
  }

  var file = new pbxFile(filePath, opt);

  if (!file || this.hasFile(file.path)) return null;

  file.fileRef = this.generateUuid();
  this.addToPbxGroup(file, group);

  if (!file) return false;

  file.target = opt ? opt.target : undefined;
  file.uuid = this.generateUuid();

  this.addToPbxBuildFileSection(file);
  this.addToPbxSourcesBuildPhase(file);

  file.models = [];
  var currentVersionName;
  var modelFiles = fs.readdirSync(file.path);
  for (var index in modelFiles) {
    var modelFileName = modelFiles[index];
    var modelFilePath = $path.join(filePath, modelFileName);

    if (modelFileName == ".xccurrentversion") {
      currentVersionName =
        plist.readFileSync(modelFilePath)._XCCurrentVersionName;
      continue;
    }

    var modelFile = new pbxFile(modelFilePath);
    modelFile.fileRef = this.generateUuid();

    this.addToPbxFileReferenceSection(modelFile);

    file.models.push(modelFile);

    if (currentVersionName && currentVersionName === modelFileName) {
      file.currentModel = modelFile;
    }
  }

  if (!file.currentModel) {
    file.currentModel = file.models[0];
  }

  this.addToXcVersionGroupSection(file);

  return file;
};

pbxProject.prototype.addTargetAttribute = function (prop, value, target) {
  var attributes = this.getFirstProject()["firstProject"]["attributes"];
  if (attributes["TargetAttributes"] === undefined) {
    attributes["TargetAttributes"] = {};
  }
  target = target || this.getFirstTarget();
  if (attributes["TargetAttributes"][target.uuid] === undefined) {
    attributes["TargetAttributes"][target.uuid] = {};
  }
  attributes["TargetAttributes"][target.uuid][prop] = value;
};

pbxProject.prototype.removeTargetAttribute = function (prop, target) {
  var attributes = this.getFirstProject()["firstProject"]["attributes"];
  target = target || this.getFirstTarget();
  if (
    attributes["TargetAttributes"] &&
    attributes["TargetAttributes"][target.uuid]
  ) {
    delete attributes["TargetAttributes"][target.uuid][prop];
  }
};

module.exports = pbxProject;
