#include "NativeAudioHlsRoute.h"
#include <iostream>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL line "<<__LINE__<<'\n';return 1;}}while(false)
int main(){QVariantMap a{{"spatialAudio",true},{"devicetype","basic"},{"device","auto"},{"channels","auto"},{"exclusive",false}};
 CHECK(NativeAudioHlsRoute::allowed(a,""));CHECK(NativeAudioHlsRoute::allowed(a,"# ao=coreaudio\nvolume=20"));
 auto v=a;v["spatialAudio"]=false;CHECK(!NativeAudioHlsRoute::allowed(v,""));CHECK(NativeAudioHlsRoute::allowed(v,"",false));CHECK(!NativeAudioHlsRoute::allowed(v,"ao=coreaudio",false));v=a;v["devicetype"]="hdmi";CHECK(!NativeAudioHlsRoute::allowed(v,""));
 v=a;v["device"]="manual";CHECK(!NativeAudioHlsRoute::allowed(v,""));v=a;v["channels"]="5.1";CHECK(!NativeAudioHlsRoute::allowed(v,""));v=a;v["exclusive"]=true;CHECK(!NativeAudioHlsRoute::allowed(v,""));
 CHECK(!NativeAudioHlsRoute::allowed(a,"ao=coreaudio"));CHECK(!NativeAudioHlsRoute::allowed(a,"\"ao\"=null"));CHECK(!NativeAudioHlsRoute::allowed(a,"audio-device=manual"));CHECK(!NativeAudioHlsRoute::allowed(a,"audio-channels=stereo"));CHECK(!NativeAudioHlsRoute::allowed(a,"audio-exclusive=yes"));CHECK(!NativeAudioHlsRoute::allowed(a,"audio-spdif=ac3"));
 std::cout<<"PASS: native HLS honors configured audio route\n";
}
