import nacl from 'tweetnacl'

type GF = Float64Array

function gf(init?: number[]): GF {
  const r = new Float64Array(16)
  if (init) {
    for (let i = 0; i < init.length; i++) {
      r[i] = init[i]!
    }
  }
  return r
}

const D = gf([
  0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e6, 0xddee, 0xf436, 0x057d, 0x0e12,
  0x1550, 0x24a0, 0x0379, 0x0a2f,
])
const I = gf([
  0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d,
  0xdf0b, 0x4fc1, 0x2480, 0x2b83,
])

function car25519(o: GF): void {
  let c = 1
  for (let i = 0; i < 16; i++) {
    const v = o[i]! + c + 65535
    c = Math.floor(v / 65536)
    o[i] = v - c * 65536
  }
  o[0]! += c - 1 + 37 * (c - 1)
}

function sel25519(p: GF, q: GF, b: number): void {
  const c = ~(b - 1)
  for (let i = 0; i < 16; i++) {
    const t = c & (p[i]! ^ q[i]!)
    p[i]! ^= t
    q[i]! ^= t
  }
}

function pack25519(o: Uint8Array, n: GF): void {
  const m = gf()
  const t = gf()
  for (let i = 0; i < 16; i++) {
    t[i] = n[i]!
  }
  car25519(t)
  car25519(t)
  car25519(t)
  for (let j = 0; j < 2; j++) {
    m[0] = t[0]! - 0xffed
    for (let i = 1; i < 15; i++) {
      m[i] = t[i]! - 0xffff - ((m[i - 1]! >> 16) & 1)
      m[i - 1]! &= 0xffff
    }
    m[15] = t[15]! - 0x7fff - ((m[14]! >> 16) & 1)
    const b = (m[15]! >> 16) & 1
    m[14]! &= 0xffff
    sel25519(t, m, 1 - b)
  }
  for (let i = 0; i < 16; i++) {
    o[2 * i] = t[i]! & 0xff
    o[2 * i + 1] = t[i]! >> 8
  }
}

function par25519(a: GF): number {
  const d = new Uint8Array(32)
  pack25519(d, a)
  return d[0]! & 1
}

function unpack25519(o: GF, n: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    o[i] = n[2 * i]! + (n[2 * i + 1]! << 8)
  }
  o[15]! &= 0x7fff
}

function A(o: GF, a: GF, b: GF): void {
  for (let i = 0; i < 16; i++) {
    o[i] = a[i]! + b[i]!
  }
}

function Z(o: GF, a: GF, b: GF): void {
  for (let i = 0; i < 16; i++) {
    o[i] = a[i]! - b[i]!
  }
}

function M(o: GF, a: GF, b: GF): void {
  const t = new Float64Array(31)
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      t[i + j]! += a[i]! * b[j]!
    }
  }
  for (let i = 0; i < 15; i++) {
    t[i]! += 38 * t[i + 16]!
  }
  for (let i = 0; i < 16; i++) {
    o[i] = t[i]!
  }
  car25519(o)
  car25519(o)
}

function S(o: GF, a: GF): void {
  M(o, a, a)
}

function inv25519(o: GF, i: GF): void {
  const c = gf()
  for (let a = 0; a < 16; a++) {
    c[a] = i[a]!
  }
  for (let a = 253; a >= 0; a--) {
    S(c, c)
    if (a !== 2 && a !== 4) {
      M(c, c, i)
    }
  }
  for (let a = 0; a < 16; a++) {
    o[a] = c[a]!
  }
}

function pow2523(o: GF, i: GF): void {
  const c = gf()
  for (let a = 0; a < 16; a++) {
    c[a] = i[a]!
  }
  for (let a = 250; a >= 0; a--) {
    S(c, c)
    if (a !== 1) {
      M(c, c, i)
    }
  }
  for (let a = 0; a < 16; a++) {
    o[a] = c[a]!
  }
}

function neq25519(a: GF, b: GF): number {
  const c = new Uint8Array(32)
  const d = new Uint8Array(32)
  pack25519(c, a)
  pack25519(d, b)
  return nacl.verify(c, d) ? 0 : -1
}

function set25519(r: GF, a: GF): void {
  for (let i = 0; i < 16; i++) {
    r[i] = a[i]! | 0
  }
}

const gf0 = gf()
const gf1 = gf([1])

export function ed25519PublicToX25519(edPk: Uint8Array): Uint8Array {
  if (edPk.length !== 32) {
    throw new Error('Invalid Ed25519 public key length')
  }
  const p = [gf(), gf(), gf(), gf()]
  const t = gf()
  const chk = gf()
  const num = gf()
  const den = gf()
  const den2 = gf()
  const den4 = gf()
  const den6 = gf()

  set25519(p[1]!, gf0)
  unpack25519(p[1]!, edPk)
  set25519(p[0]!, gf1)
  S(num, p[1]!)
  M(den, num, D)
  Z(num, num, p[0]!)
  A(den, p[0]!, den)

  S(den2, den)
  S(den4, den2)
  M(den6, den4, den2)
  M(t, den6, num)
  M(t, t, den)

  pow2523(t, t)
  M(t, t, num)
  M(t, t, den)
  M(t, t, den)
  M(p[0]!, t, den)

  S(chk, p[0]!)
  M(chk, chk, den)
  if (neq25519(chk, num) !== 0) {
    M(p[0]!, p[0]!, I)
  }

  S(chk, p[0]!)
  M(chk, chk, den)
  if (neq25519(chk, num) !== 0) {
    throw new Error('Invalid Ed25519 public key')
  }

  if (par25519(p[0]!) === edPk[31]! >> 7) {
    Z(p[0]!, gf0, p[0]!)
  }
  M(p[3]!, p[0]!, p[1]!)

  const yplusone = gf()
  const oneminusy = gf()
  A(yplusone, gf1, p[1]!)
  Z(oneminusy, gf1, p[1]!)
  inv25519(oneminusy, oneminusy)
  M(yplusone, yplusone, oneminusy)

  const out = new Uint8Array(32)
  pack25519(out, yplusone)
  return out
}
