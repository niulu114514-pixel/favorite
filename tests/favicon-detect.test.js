import assert from 'node:assert/strict'
import test from 'node:test'

import { detectMimeType, looksLikeImage } from '../functions/api/favicon.js'

function bytes(...values) {
  return new Uint8Array(values).buffer
}

function utf8(text) {
  return new TextEncoder().encode(text).buffer
}

test('识别常见位图格式', () => {
  assert.equal(looksLikeImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), true, 'PNG')
  assert.equal(looksLikeImage(bytes(0xff, 0xd8, 0xff, 0xe0)), true, 'JPEG')
  assert.equal(looksLikeImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39)), true, 'GIF')
  assert.equal(looksLikeImage(bytes(0x00, 0x00, 0x01, 0x00, 0x20)), true, 'ICO')
  assert.equal(looksLikeImage(bytes(0x42, 0x4d, 0x00, 0x00)), true, 'BMP')
})

test('识别 WEBP 与 AVIF', () => {
  const webp = bytes(
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50
  )
  assert.equal(looksLikeImage(webp), true, 'WEBP')

  const avif = new Uint8Array(16)
  avif.set([0x00, 0x00, 0x00, 0x20], 0)
  avif.set([0x66, 0x74, 0x79, 0x70], 4) // ftyp
  avif.set([0x61, 0x76, 0x69, 0x66], 8) // avif
  assert.equal(looksLikeImage(avif.buffer), true, 'AVIF')
})

test('识别 SVG 文本', () => {
  assert.equal(looksLikeImage(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), true)
  assert.equal(
    looksLikeImage(utf8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')),
    true
  )
})

test('HTML 页面不算图片', () => {
  assert.equal(looksLikeImage(utf8('<!doctype html><html lang="en"><head>')), false)
  assert.equal(looksLikeImage(utf8('<!DOCTYPE HTML><html>')), false)
})

test('任意文本与空内容不算图片', () => {
  assert.equal(looksLikeImage(utf8('PENTEST_OVERWRITE_49200')), false)
  assert.equal(looksLikeImage(utf8('Not Found')), false)
  assert.equal(looksLikeImage(new ArrayBuffer(0)), false)
  assert.equal(looksLikeImage(bytes(0x01, 0x02)), false)
})

test('SVG 按图片类型返回，而不是降级成下载附件', () => {
  const svg = utf8('<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"></svg>')
  // 之前统一返回 application/octet-stream + Content-Disposition: attachment，
  // <img> 会拒绝渲染，导致所有 SVG 图标显示为空白。
  assert.equal(detectMimeType(svg), 'image/svg+xml')
  assert.equal(detectMimeType(utf8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml')
})

test('位图仍返回各自的 MIME', () => {
  assert.equal(
    detectMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    'image/png'
  )
  assert.equal(detectMimeType(bytes(0x00, 0x00, 0x01, 0x00, 0x20)), 'image/x-icon')
  const avif = new Uint8Array(16)
  avif.set([0x00, 0x00, 0x00, 0x20], 0)
  avif.set([0x66, 0x74, 0x79, 0x70], 4)
  avif.set([0x61, 0x76, 0x69, 0x66], 8)
  assert.equal(detectMimeType(avif.buffer), 'image/avif')
})
