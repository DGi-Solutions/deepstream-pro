#include "../src/player/FramebufferGlProbe.h"
#include <cassert>
#include <cstdint>
#include <iostream>
struct FakeFormat {std::uint32_t actual; std::uint32_t internalTextureFormat() const {return actual;}};
struct FakeFbo {
    bool valid; std::uint32_t actual; mutable int formatReads = 0;
    bool isValid() const {return valid;}
    FakeFormat format() const {++formatReads;return {actual};}
};
struct MockGl {
    int binding = 42, queries = 0; bool complete = true, queryWorks = true;
    void glGetIntegerv(unsigned, int *out) { *out=binding; }
    void glBindFramebuffer(unsigned, unsigned next) {binding=static_cast<int>(next);}
    unsigned glCheckFramebufferStatus(unsigned) {return complete ? 0x8CD5 : 0;}
    void glGetFramebufferAttachmentParameteriv(unsigned,unsigned,unsigned,int *out) {
        ++queries; if(queryWorks)*out=16;
    }
};
int main() {
    MockGl gl;
    auto bits=readGlFramebufferChannels(&gl,99);
    assert(bits.verified() && bits.red==16 && gl.binding==42 && gl.queries==3);
    gl.complete=false;gl.queries=0;bits=readGlFramebufferChannels(&gl,99);
    assert(!bits.verified() && gl.binding==42 && gl.queries==0);
    gl.complete=true;gl.queryWorks=false;bits=readGlFramebufferChannels(&gl,99);
    assert(!bits.verified() && gl.binding==42);
    constexpr std::uint32_t rgba16f=0x881A,rgba8=0x8058;
    assert(!qtFramebufferFormat(static_cast<const FakeFbo*>(nullptr)));
    FakeFbo failed{false,rgba16f};assert(!qtFramebufferFormat(&failed));assert(failed.formatReads==0);
    FakeFbo high{true,rgba16f};assert(qtFramebufferFormat(&high)==rgba16f);
    FakeFbo fallback{true,rgba8};assert(qtFramebufferFormat(&fallback)==rgba8);
    const FramebufferChannelBits hi{16,16,16}, low{8,8,8}, invalid{};
    assert(mpvRenderDepthHint(hi,10,10,10,10,10,10)==10);
    assert(mpvRenderDepthHint(low,10,10,10,10,10,10)==8);
    assert(mpvRenderDepthHint(hi,10,10,10,10,10,10)==10); // recreated FBO
    assert(mpvRenderDepthHint(hi,10,10,10,8,8,8)==8);
    assert(mpvRenderDepthHint(hi,10,10,10,10,9,10)==9);
    assert(mpvRenderDepthHint(hi,-1,10,10,10,10,10)==8);
    assert(mpvRenderDepthHint(invalid,10,10,10,10,10,10)==8);
    assert(mpvRenderDepthHint({16,-1,16},10,10,10,10,10,10)==8);
    std::cout << "format provenance and per-frame render depth cases passed\n";
}
