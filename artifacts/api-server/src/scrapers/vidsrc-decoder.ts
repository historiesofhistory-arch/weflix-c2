function bMGyx71TzQLfdonN(s: string): string {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += 3) parts.push(s.slice(i, i + 3));
  return parts.reverse().join("");
}
function Iry9MQXnLs(s: string): string {
  const key = "pWB9V)[*4I`nJpp?ozyB~dbr9yt!_n4u";
  const bytes = (s.match(/.{1,2}/g) ?? []).map(h => String.fromCharCode(parseInt(h, 16))).join("");
  let xored = "";
  for (let i = 0; i < bytes.length; i++)
    xored += String.fromCharCode(bytes.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  let shifted = "";
  for (let i = 0; i < xored.length; i++)
    shifted += String.fromCharCode(xored.charCodeAt(i) - 3);
  return Buffer.from(shifted, "base64").toString("utf8");
}
function IGLImMhWrI(s: string): string {
  const rev = s.split("").reverse().join("");
  const rot13 = rev.replace(/[a-zA-Z]/g, c =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13)));
  return Buffer.from(rot13.split("").reverse().join(""), "base64").toString("utf8");
}
function GTAxQyTyBx(s: string): string {
  const rev = s.split("").reverse().join("");
  let out = "";
  for (let i = 0; i < rev.length; i += 2) out += rev[i];
  return Buffer.from(out, "base64").toString("utf8");
}
function C66jPHx8qu(s: string): string {
  const key = "X9a(O;FMV2-7VO5x;Ao:dN1NoFs?j,";
  const rev = s.split("").reverse().join("");
  const bytes = (rev.match(/.{1,2}/g) ?? []).map(h => String.fromCharCode(parseInt(h, 16))).join("");
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += String.fromCharCode(bytes.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return out;
}
function MyL1IRSfHe(s: string): string {
  const rev = s.split("").reverse().join("");
  let shifted = "";
  for (let i = 0; i < rev.length; i++) shifted += String.fromCharCode(rev.charCodeAt(i) - 1);
  let hex = "";
  for (let i = 0; i < shifted.length; i += 2) hex += String.fromCharCode(parseInt(shifted.substr(i, 2), 16));
  return hex;
}
function detdj7JHiK(s: string): string {
  const inner = s.slice(10, -16);
  const key = '3SAY~#%Y(V%>5d/Yg"$G[Lh1rK4a;7ok';
  const decoded = Buffer.from(inner, "base64").toString("binary");
  const keyRep = key.repeat(Math.ceil(decoded.length / key.length)).substring(0, decoded.length);
  let out = "";
  for (let i = 0; i < decoded.length; i++)
    out += String.fromCharCode(decoded.charCodeAt(i) ^ keyRep.charCodeAt(i));
  return out;
}
function nZlUnj2VSo(s: string): string {
  const map: Record<string, string> = {
    x:"a",y:"b",z:"c",a:"d",b:"e",c:"f",d:"g",e:"h",f:"i",g:"j",h:"k",i:"l",j:"m",
    k:"n",l:"o",m:"p",n:"q",o:"r",p:"s",q:"t",r:"u",s:"v",t:"w",u:"x",v:"y",w:"z",
    X:"A",Y:"B",Z:"C",A:"D",B:"E",C:"F",D:"G",E:"H",F:"I",G:"J",H:"K",I:"L",J:"M",
    K:"N",L:"O",M:"P",N:"Q",O:"R",P:"S",Q:"T",R:"U",S:"V",T:"W",U:"X",V:"Y",W:"Z",
  };
  return s.replace(/[xyzabcdefghijklmnopqrstuvwXYZABCDEFGHIJKLMNOPQRSTUVW]/g, c => map[c] ?? c);
}
function laM1dAi3vO(s: string): string {
  const rev = s.split("").reverse().join("").replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(rev, "base64").toString("binary");
  let out = "";
  for (let i = 0; i < decoded.length; i++) out += String.fromCharCode(decoded.charCodeAt(i) - 5);
  return out;
}
function GuxKGDsA2T(s: string): string {
  const rev = s.split("").reverse().join("").replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(rev, "base64").toString("binary");
  let out = "";
  for (let i = 0; i < decoded.length; i++) out += String.fromCharCode(decoded.charCodeAt(i) - 7);
  return out;
}
function LXVUMCoAHJ(s: string): string {
  const rev = s.split("").reverse().join("").replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(rev, "base64").toString("binary");
  let out = "";
  for (let i = 0; i < decoded.length; i++) out += String.fromCharCode(decoded.charCodeAt(i) - 3);
  return out;
}

export function vidsrcDecrypt(param: string, type: string): string | null {
  switch (type) {
    case "LXVUMCoAHJ": return LXVUMCoAHJ(param);
    case "GuxKGDsA2T": return GuxKGDsA2T(param);
    case "laM1dAi3vO": return laM1dAi3vO(param);
    case "nZlUnj2VSo": return nZlUnj2VSo(param);
    case "Iry9MQXnLs": return Iry9MQXnLs(param);
    case "IGLImMhWrI": return IGLImMhWrI(param);
    case "GTAxQyTyBx": return GTAxQyTyBx(param);
    case "C66jPHx8qu": return C66jPHx8qu(param);
    case "MyL1IRSfHe": return MyL1IRSfHe(param);
    case "detdj7JHiK": return detdj7JHiK(param);
    case "bMGyx71TzQLfdonN": return bMGyx71TzQLfdonN(param);
    default: return null;
  }
}
