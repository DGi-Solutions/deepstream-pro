#pragma once
#include <algorithm>
#include <cstdint>
#include <optional>

// Qt's FBO format describes the Qt configuration; it is not by itself a
// driver readback of the attachment. Do not infer bit depth from this value.
template<class Framebuffer>
std::optional<std::uint32_t> qtFramebufferFormat(const Framebuffer* framebuffer)
{
    if (!framebuffer || !framebuffer->isValid()) return std::nullopt;
    return static_cast<std::uint32_t>(framebuffer->format().internalTextureFormat());
}
struct FramebufferChannelBits {
    int red = 0, green = 0, blue = 0;
    bool verified() const {return red > 0 && green > 0 && blue > 0;}
};
// Unknowns produce a conservative 8-bit render hint, not a capability claim.
// Later compositor stages and the external display link remain unverified.
inline int mpvRenderDepthHint(FramebufferChannelBits fbo,
                              int cr, int cg, int cb, int sr, int sg, int sb)
{
    if (!fbo.verified() || cr <= 0 || cg <= 0 || cb <= 0 || sr <= 0 || sg <= 0 || sb <= 0) return 8;
    return std::min({10,fbo.red,fbo.green,fbo.blue,cr,cg,cb,sr,sg,sb});
}
