#include "HlsDolbyManifestEvidence.h"
#include <cassert>
#include <string>
using HlsDolbyManifestEvidence::inspect;
int main(){
 const std::string base="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200,CODECS=\"hvc1.2.4.L150,mp4a.40.2\",";
 const std::string secret="movie.m3u8?ApiKey=secret\n";
 auto a=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\n"+secret);
 assert(a.available&&a.variants==1&&a.dv81==1&&a.dv84==0);
 auto b=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.07/db4h\",VIDEO-RANGE=HLG\n"+secret);
 assert(b.available&&b.dv84==1);
 auto c=inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO-RANGE=PQ\na\n");
 assert(c.available&&c.dv5==1);
 auto bad=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=HLG\n"+secret);
 assert(bad.available&&bad.dv81==0&&bad.unknown==1);
 auto mixed=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\n"+secret+
                    "#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO-RANGE=PQ\nb.m3u8\n");
 assert(mixed.available&&mixed.variants==2&&mixed.dv81==1&&mixed.dv5==1);
 auto conflicting=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p,dvhe.07.06\",VIDEO-RANGE=PQ\n"+secret);
 assert(conflicting.available&&conflicting.unknown==1&&conflicting.dv81==0);
 auto invalidHevc=inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=\"hvc1.invalid\",SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\na\n");
 assert(invalidHevc.available&&invalidHevc.unknown==1&&invalidHevc.dv81==0);
 auto invalidLevel=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.99/db1p\",VIDEO-RANGE=PQ\n"+secret);
 assert(invalidLevel.available&&invalidLevel.unknown==1&&invalidLevel.dv81==0);
 auto bothInvalid=inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=\"hvc1.invalid\",SUPPLEMENTAL-CODECS=\"dvh1.08.99/db1p\",VIDEO-RANGE=PQ\na\n");
 assert(bothInvalid.available&&bothInvalid.unknown==1&&bothInvalid.dv81==0);
 auto commonHevc=inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=\"hvc1.2.20000000.L153.B0\",SUPPLEMENTAL-CODECS=\"dvh1.08.07/db4h\",VIDEO-RANGE=HLG\na\n");
 assert(commonHevc.available&&commonHevc.dv84==1);
 auto invalidMain=inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=\"hvc1.1.4.L123.B0\",SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\na\n");
 assert(invalidMain.available&&invalidMain.unknown==1&&invalidMain.dv81==0);
 auto zeroLevel=inspect(base+"SUPPLEMENTAL-CODECS=\"dvh1.08.00/db1p\",VIDEO-RANGE=PQ\n"+secret);
 assert(zeroLevel.available&&zeroLevel.unknown==1&&zeroLevel.dv81==0);
 assert(!inspect(base+"VIDEO-RANGE=PQ,VIDEO-RANGE=HLG\na\n").available);
 assert(!inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=dvh1.05.06\na\n").available);
 assert(!inspect(base+"VIDEO-RANGE=PQ\n#EXT-X-KEY:METHOD=NONE\na\n").available);
 assert(!inspect("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10\n").available);
 assert(!inspect(std::string(1024*1024+1,'x')).available);
 assert(!inspect("#EXTM3U\n#EXTINF:1\na.ts\n").available);
 HlsDolbyManifestEvidence::BoundSummary gate;
 const auto offered=base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\n"+secret;
 gate.observe(1,2,true,true,1,1,offered);assert(!gate.read(2).available);
 gate.observe(2,2,false,true,1,1,offered);assert(!gate.read(2).available);
 gate.observe(2,2,true,false,1,1,offered);assert(!gate.read(2).available);
 gate.observe(2,2,true,true,1,2,offered);assert(!gate.read(2).available);
 gate.observe(2,2,true,true,2,2,offered);assert(gate.read(2).dv81==1);
 assert(!gate.read(3).available);
 gate.clear();assert(!gate.read(2).available);
 gate.observe(2,3,true,true,1,1,offered);assert(!gate.read(3).available);

 // The actual rewritten loopback URL stays inside the native process. Only a
 // matching most-recent access-log entry can return a profile declaration.
 HlsDolbyManifestEvidence::BoundVariantLookup variants;
 const std::string local1="http://127.0.0.1:1234/sensitive-capability/1/resource.m3u8";
 const std::string local2="http://127.0.0.1:1234/sensitive-capability/2/resource.m3u8";
 const auto rewritten=base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\n"+local1+"\n"+
    "#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO-RANGE=PQ\n"+local2+"\n";
 variants.observe(2,2,true,true,1,1,rewritten);
 assert(variants.lastObserved(2,local1)=="8.1");
 assert(variants.lastObserved(2,local2)=="5");
 assert(variants.lastObserved(3,local1)=="unknown");
 assert(variants.lastObserved(2,local1+"?ApiKey=secret")=="unknown");
 variants.observe(1,2,true,true,2,2,rewritten);assert(variants.lastObserved(2,local1)=="8.1");
 variants.observe(2,2,true,true,2,3,rewritten);assert(variants.lastObserved(2,local1)=="unknown");
 variants.clear();variants.observe(2,2,true,true,2,2,rewritten);assert(variants.lastObserved(2,local1)=="8.1");
 const auto duplicate=rewritten+"#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO-RANGE=PQ\n"+local1+"\n";
 variants.observe(2,2,true,true,3,3,duplicate);assert(variants.lastObserved(2,local1)=="unknown");
 // A fresh alias may qualify; an alias observed in an earlier accepted root
 // remains unknown after refresh, even if its declaration later reverts.
 const std::string newAlias="http://127.0.0.1:1234/sensitive-capability/3/resource.m3u8";
 const auto refreshed=base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\n"+newAlias+"\n";
 variants.observe(2,2,true,true,4,4,refreshed);
 assert(variants.lastObserved(2,local1)=="unknown");
 assert(variants.lastObserved(2,newAlias)=="8.1");
 variants.observe(2,2,true,true,5,5,"#EXTM3U\ninvalid");assert(variants.lastObserved(2,newAlias)=="unknown");
 variants.clear();assert(variants.lastObserved(2,local1)=="unknown");
 HlsDolbyManifestEvidence::BoundVariantLookup reused;
 const auto first="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO-RANGE=PQ\n"+local1+"\n";
 const auto changed=base+"SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\",VIDEO-RANGE=PQ\n"+local1+"\n";
 reused.observe(9,9,true,true,1,1,first);assert(reused.lastObserved(9,local1)=="5");
 reused.invalidateCurrent();assert(reused.lastObserved(9,local1)=="unknown");
 reused.observe(9,9,true,true,2,2,changed);assert(reused.lastObserved(9,local1)=="unknown");
 reused.observe(9,9,true,true,3,3,first);assert(reused.lastObserved(9,local1)=="unknown");
 reused.observe(9,9,true,true,1,3,changed);assert(reused.lastObserved(9,local1)=="unknown");
 reused.observe(9,9,true,true,4,4,first);assert(reused.lastObserved(9,local1)=="unknown");
 reused.clear();reused.observe(10,10,true,true,1,1,first);assert(reused.lastObserved(10,local1)=="5");
 HlsDolbyManifestEvidence::BoundVariantLookup unparseable;
 const auto quotedSpace="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO=\"Main Profile\"\n"+local1+"\n";
 unparseable.observe(20,20,true,true,1,1,quotedSpace);
 unparseable.observe(20,20,true,true,2,2,changed);
 assert(unparseable.lastObserved(20,local1)=="unknown");
 unparseable.clear();unparseable.observe(21,21,true,true,1,1,first);assert(unparseable.lastObserved(21,local1)=="5");
 HlsDolbyManifestEvidence::BoundVariantLookup bounded;
 for(unsigned i=1;i<=2100;++i){
  const auto u="http://127.0.0.1/"+std::to_string(i);
  const auto body="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS=\"dvh1.05.06\",VIDEO-RANGE=PQ\n"+u+"\n";
  bounded.invalidateCurrent();bounded.observe(11,11,true,true,i,i,body);
 }
 assert(bounded.lastObserved(11,"http://127.0.0.1/2100")=="unknown");
 bounded.clear();bounded.observe(12,12,true,true,1,1,first);assert(bounded.lastObserved(12,local1)=="5");
}
