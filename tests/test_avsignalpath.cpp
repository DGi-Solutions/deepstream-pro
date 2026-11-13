#include "ExperimentalAVSignalPath.h"
#include <iostream>
int main(){
 auto a=experimentalAVSignalPath(ExperimentalAVSourceEvidence::Unknown);
 auto b=experimentalAVSignalPath(ExperimentalAVSourceEvidence::SingleJocSelected);
 bool ok=a.value("backend")=="avplayer" && a.value("engine")=="AVPlayer" && a.value("outputDriver")=="AVFoundation" &&
 !a.value("objectRenderingConfirmed").toBool() && !b.value("objectRenderingConfirmed").toBool() &&
 a.value("sourceEvidence").toMap().value("status")=="unknown" &&
 b.value("sourceEvidence").toMap().value("status")=="manifest-single-joc-selected" &&
 a.value("decoded").toMap().isEmpty() && a.value("output").toMap().isEmpty() && !a.contains("decoder") && !a.contains("url");
 if(!ok){std::cerr<<"FAIL: AV signal path contract\n";return 1;}
 std::cout<<"PASS: AV signal path has no stale mpv values or rendering claim\n";return 0;
}
