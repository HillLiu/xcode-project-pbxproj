const {expect} = require("chai");
const {init} = require("../init");

describe("Test xcode-project-pbxproj", () => {
  it("basic testt", () => {
    /*your test code*/
    const actual = init();
    expect(actual).to.be.undefined;
  });
});
