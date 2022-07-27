const pbxGroupChild = (file) => {
  const obj = Object.create(null);

  obj.value = file.fileRef ?? file[0];
  obj.comment = file.basename ?? file[1];

  return obj;
};

module.exports = pbxGroupChild;
