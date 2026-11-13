#include "MpvVideoItem.h"
#include "PlayerComponent.h"
#include "FramebufferFormatProbe.h"
#include "FramebufferChannelProbe.h"
#include <MpvController>
#include <QDebug>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QOpenGLFunctions>
#include <QSurface>
#include <QQuickOpenGLUtils>
#include <QQuickWindow>
#include "../../external/mpvqt/src/mpvrenderer.h"
#include "../../external/mpvqt/src/mpvabstractitem_p.h"

namespace {
class DeepStreamVideoRenderer final : public MpvRenderer
{
public:
    explicit DeepStreamVideoRenderer(MpvAbstractItem *item) : MpvRenderer(item) {}

    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) override
    {
        // Upstream creates the libmpv context before its first framebuffer.
        delete MpvRenderer::createFramebufferObject(size);
        QOpenGLFramebufferObjectFormat format;
        format.setAttachment(QOpenGLFramebufferObject::CombinedDepthStencil);
        format.setInternalTextureFormat(GL_RGBA16F);
        auto *buffer = new QOpenGLFramebufferObject(size, format);
        if (!buffer->isValid()) {
            qWarning() << "DeepStream high precision framebuffer unavailable";
            delete buffer;
            buffer = QQuickFramebufferObject::Renderer::createFramebufferObject(size);
        }
        const auto qtFormat = qtFramebufferFormat(buffer);
        m_framebufferBits = readFramebufferChannelBits(buffer);
        if (!qtFormat) {
            qWarning() << "DeepStream video framebuffer format unavailable";
        } else {
            qInfo() << "DeepStream Qt video framebuffer internal format:"
                    << QStringLiteral("0x%1").arg(*qtFormat, 0, 16);
            if (*qtFormat != GL_RGBA16F)
                qWarning() << "DeepStream Qt FBO format differs from requested RGBA16F";
        }

        if (m_framebufferBits.verified())
            qInfo() << "DeepStream GL video FBO RGB bits:"
                    << m_framebufferBits.red << m_framebufferBits.green << m_framebufferBits.blue;
        else
            qWarning() << "DeepStream GL video FBO RGB bit depth unavailable";

        // Do not write mpv's dither-depth from the render thread: a high-bit
        // FBO alone does not establish display depth, and blocking on normal
        // libmpv calls from this thread can deadlock. Leave the existing mpv
        // or user setting intact, including after an FBO fallback.
        return buffer;
    }

    void render() override
    {
        // Qt Quick and libmpv share one GL context and must restore its state.
        QQuickOpenGLUtils::resetOpenGLState();
        auto *buffer = framebufferObject();
        if (!buffer || !buffer->isValid())
            return;
        auto *context = QOpenGLContext::currentContext();
        QSurfaceFormat contextFormat, surfaceFormat;
        if (context) {
            contextFormat = context->format();
            if (context->surface()) surfaceFormat = context->surface()->format();
        }
        int depth = mpvRenderDepthHint(m_framebufferBits,
            contextFormat.redBufferSize(), contextFormat.greenBufferSize(), contextFormat.blueBufferSize(),
            surfaceFormat.redBufferSize(), surfaceFormat.greenBufferSize(), surfaceFormat.blueBufferSize());
        mpv_opengl_fbo target{static_cast<int>(buffer->handle()), buffer->width(), buffer->height(),
                              static_cast<int>(buffer->format().internalTextureFormat())};
        int flipY = 0;
        mpv_render_param params[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &target},
                                     {MPV_RENDER_PARAM_DEPTH, &depth},
                                     {MPV_RENDER_PARAM_FLIP_Y, &flipY},
                                     {MPV_RENDER_PARAM_INVALID, nullptr}};
        auto *item = static_cast<MpvVideoItem *>(m_mpvAItem);
        mpv_render_context_render(item->renderContext(), params);
        // Movie frames are opaque even when the surrounding browser is transparent.
        auto *gl = QOpenGLContext::currentContext()->functions();
        buffer->bind();
        gl->glDisable(GL_SCISSOR_TEST);
        gl->glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_TRUE);
        gl->glClearColor(0, 0, 0, 1);
        gl->glClear(GL_COLOR_BUFFER_BIT);
        gl->glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        QQuickOpenGLUtils::resetOpenGLState();
    }
private:
    FramebufferChannelBits m_framebufferBits;
};
}

QQuickFramebufferObject::Renderer *MpvVideoItem::createRenderer() const
{
    return new DeepStreamVideoRenderer(const_cast<MpvVideoItem *>(this));
}

MpvVideoItem::MpvVideoItem(QQuickItem *parent)
    : MpvAbstractItem(parent)
{
    connect(this, &MpvAbstractItem::ready, this, [this]() {
        qDebug() << "MpvVideoItem ready() signal fired!";
        m_ready = true;
        initialize();
    });

    qDebug() << "MpvVideoItem constructed";
    // Critical: Set vo=libmpv for Qt integration
    Q_EMIT setProperty("vo", "libmpv");

#ifdef Q_OS_WIN32
    // Force desktop OpenGL and disable advanced features for compatibility with older GPUs
    Q_EMIT setProperty("gpu-api", "opengl");
    Q_EMIT setProperty("opengl-es", "no");
#endif
}

void MpvVideoItem::setPlayerComponent(PlayerComponent* player)
{
    qDebug() << "MpvVideoItem::setPlayerComponent called, mpvController():" << mpvController();
    m_player = player;
    initialize();
}

void MpvVideoItem::initialize() {
    if (m_initialized) {
        qDebug() << "MpvVideoItem is already initialized, ignoring";
        return;
    }

    if (!m_ready) {
        qDebug() << "MpvVideoItem not ready yet, waiting for ready() signal";
        return;
    }

    if (!m_player) {
        qDebug() << "MpvVideoItem has no player, waiting for setPlayerComponent()";
        return;
    }

    m_initialized = true;

    qDebug() << "MpvVideoItem ready, initializing now";
    m_player->setMpvController(mpvController());
    m_player->initializeMpv();
}

mpv_render_context *MpvVideoItem::renderContext() const
{
    return d_ptr->m_mpv_gl;
}
