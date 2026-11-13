#include "../src/player/FramebufferGlProbe.h"
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include <iostream>
struct GLAdapter {
    void glGetIntegerv(unsigned p,int *v){::glGetIntegerv(p,v);}
    void glBindFramebuffer(unsigned t,unsigned id){::glBindFramebuffer(t,id);}
    unsigned glCheckFramebufferStatus(unsigned t){return ::glCheckFramebufferStatus(t);}
    void glGetFramebufferAttachmentParameteriv(unsigned t,unsigned a,unsigned p,int *v){::glGetFramebufferAttachmentParameteriv(t,a,p,v);}
};
int main(){
    CGLPixelFormatAttribute attrs[]={kCGLPFAOpenGLProfile,(CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,(CGLPixelFormatAttribute)0};
    CGLPixelFormatObj pixel=nullptr;GLint count=0;
    if(CGLChoosePixelFormat(attrs,&pixel,&count)!=kCGLNoError||!pixel){std::cerr<<"pixel_format_unavailable\n";return 77;}
    CGLContextObj ctx=nullptr;
    if(CGLCreateContext(pixel,nullptr,&ctx)!=kCGLNoError||!ctx){CGLReleasePixelFormat(pixel);std::cerr<<"context_create_failed\n";return 77;}
    CGLReleasePixelFormat(pixel);
    if(CGLSetCurrentContext(ctx)!=kCGLNoError){CGLReleaseContext(ctx);std::cerr<<"context_bind_failed\n";return 77;}
    GLuint textures[2],fbo[2];glGenTextures(2,textures);glGenFramebuffers(2,fbo);
    const GLint formats[]={GL_RGBA16F,GL_RGBA8};
    for(int i=0;i<2;i++){
        glBindTexture(GL_TEXTURE_2D,textures[i]);
        glTexImage2D(GL_TEXTURE_2D,0,formats[i],32,32,0,GL_RGBA,GL_UNSIGNED_BYTE,nullptr);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER,fbo[i]);
        glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,textures[i],0);
        if(glCheckFramebufferStatus(GL_DRAW_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE){std::cerr<<"fbo_unavailable\n";return 77;}
    }
    GLAdapter gl;glBindFramebuffer(GL_DRAW_FRAMEBUFFER,fbo[1]);GLint before=-1,after=-1;
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING,&before);
    const auto hi=readGlFramebufferChannels(&gl,fbo[0]);
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING,&after);
    const auto lo=readGlFramebufferChannels(&gl,fbo[1]);
    bool ok=hi.verified() && lo.verified() && before==after &&
        hi.red>=10 && hi.green>=10 && hi.blue>=10 &&
        lo.red==8 && lo.green==8 && lo.blue==8;
    std::cout<<"CGL attachments high="<<hi.red<<","<<hi.green<<","<<hi.blue
             <<" low="<<lo.red<<","<<lo.green<<","<<lo.blue
             <<" binding_restored="<<(before==after)<<"\n";
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER,0);glDeleteFramebuffers(2,fbo);glDeleteTextures(2,textures);
    CGLSetCurrentContext(nullptr);CGLReleaseContext(ctx);
    return ok?0:1;
}
