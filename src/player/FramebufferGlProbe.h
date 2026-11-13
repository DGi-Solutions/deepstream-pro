#pragma once
#include "FramebufferFormatProbe.h"

// Invoke only with an active OpenGL 3+ context. All queried RGB sizes must be
// positive; preserve the caller's draw framebuffer regardless of the outcome.
// The GL facade is QOpenGLFunctions in the app, or a CGL test adapter.
template<class GL>
FramebufferChannelBits readGlFramebufferChannels(GL *gl, unsigned framebuffer)
{
    if (!gl || !framebuffer) return {};
    constexpr unsigned drawBinding = 0x8CA6, drawFramebuffer = 0x8CA9;
    constexpr unsigned complete = 0x8CD5, attachment = 0x8CE0;
    constexpr unsigned redSize = 0x8212, greenSize = 0x8213, blueSize = 0x8214;
    int previous = -1;
    gl->glGetIntegerv(drawBinding, &previous);
    if (previous < 0) return {};
    gl->glBindFramebuffer(drawFramebuffer, framebuffer);
    const unsigned status = gl->glCheckFramebufferStatus(drawFramebuffer);
    int red = -1, green = -1, blue = -1;
    if (status == complete) {
        gl->glGetFramebufferAttachmentParameteriv(drawFramebuffer, attachment, redSize, &red);
        gl->glGetFramebufferAttachmentParameteriv(drawFramebuffer, attachment, greenSize, &green);
        gl->glGetFramebufferAttachmentParameteriv(drawFramebuffer, attachment, blueSize, &blue);
    }
    gl->glBindFramebuffer(drawFramebuffer, static_cast<unsigned>(previous));
    return (red > 0 && green > 0 && blue > 0) ? FramebufferChannelBits{red, green, blue} : FramebufferChannelBits{};
}
