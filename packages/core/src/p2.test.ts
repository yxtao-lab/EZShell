import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySnippetVariables } from "./snippet";
import { parseOpenSshConfig } from "./openssh";
import { parseMobaSessions } from "./moba";
import { buildPlainBackup, encryptBackup, openBackup } from "./backup-crypto";

describe("applySnippetVariables", () => {
  it("替换 host/user/name/port", () => {
    const text = applySnippetVariables("ssh {user}@{host} -p {port} # {name}", {
      host: "10.0.0.1",
      username: "alice",
      name: "生产机",
      port: 2222,
    });
    assert.equal(text, "ssh alice@10.0.0.1 -p 2222 # 生产机");
  });
});

describe("parseOpenSshConfig", () => {
  it("解析 Host 块并忽略通配", () => {
    const hosts = parseOpenSshConfig(`
Host *
  Compression yes
Host web prod
  HostName 1.2.3.4
  User deploy
  Port 2200
Host db
  HostName db.internal
  User root
`);
    assert.equal(hosts.length, 2);
    assert.deepEqual(hosts[0], {
      name: "web",
      host: "1.2.3.4",
      port: 2200,
      username: "deploy",
    });
    assert.equal(hosts[1]?.name, "db");
  });
});

describe("parseMobaSessions", () => {
  it("仅导入 #109# SSH 并读取 SubRep", () => {
    const drafts = parseMobaSessions(`
[Bookmarks]
SubRep=
ImgNum=41
skiprdp=#140#0%1.1.1.1%3389%admin
[Bookmarks_1]
SubRep=Azure\\PRE
ImgNum=41
web01=#109#0%10.0.0.8%22%ubuntu%%-1%-1%%%22%%0%0%Interactive shell%%%-1%0%0%0%%1080#MobaFont%10%0
`);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.name, "web01");
    assert.equal(drafts[0]?.host, "10.0.0.8");
    assert.equal(drafts[0]?.port, 22);
    assert.equal(drafts[0]?.username, "ubuntu");
    assert.equal(drafts[0]?.groupName, "Azure/PRE");
    assert.match(drafts[0]?.remark ?? "", /无法还原/);
  });
});

describe("backup crypto", () => {
  it("明文往返", () => {
    const payload = {
      hosts: [{ id: "a" }],
      groups: [],
      snippets: [],
      forwards: [],
    };
    const file = buildPlainBackup(payload);
    const opened = openBackup(file);
    assert.equal((opened.hosts[0] as { id: string }).id, "a");
  });

  it("加密正确口令可恢复，错误口令失败", () => {
    const payload = {
      hosts: [{ id: "b" }],
      groups: [],
      snippets: [{ id: "s" }],
      forwards: [],
    };
    const file = encryptBackup(payload, "secret-pass");
    const ok = openBackup(file, "secret-pass");
    assert.equal((ok.hosts[0] as { id: string }).id, "b");
    assert.throws(() => openBackup(file, "wrong"), /口令错误|损坏/);
  });
});
