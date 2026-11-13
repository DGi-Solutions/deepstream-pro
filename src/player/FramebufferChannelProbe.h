#pragma once
#include "FramebufferGlProbe.h"
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QOpenGLFunctions>

// Called on the current GL render context. Unknown or unsupported remains
// unknown; no GL state is retained or changed after the probe returns.
inline FramebufferChannelBits readFramebufferChannelBits(const QOpenGLFramebufferObject *buffer)
{
    QOpenGLContext *context = QOpenGLContext::currentContext();
    if (!buffer || !buffer->isValid() || !context || context->format().majorVersion() < 3)
        return {};
    return readGlFramebufferChannels(context->functions(), buffer->handle());
}
