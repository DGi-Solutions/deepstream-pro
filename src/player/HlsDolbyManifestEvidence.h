#pragma once
#include <cstddef>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

// Declaration of OFFERED HLS variants, never selection or rendered output.
// Parser consumes data in memory and returns only bounded aggregate counts.
namespace HlsDolbyManifestEvidence {
struct Summary {
 bool available=false;
 unsigned variants=0, dv5=0, dv81=0, dv84=0, unknown=0;
};
inline bool hasControlOrSpace(const std::string& s) {
 for(unsigned char c:s) if(c<=32 || c==127 || c=='"') return true;
 return false;
}
inline bool attributes(const std::string& text,std::map<std::string,std::string>& out) {
 std::size_t p=0;
 while(p<text.size()){
  const auto start=p;
  while(p<text.size() && ((text[p]>='A'&&text[p]<='Z')||(text[p]>='0'&&text[p]<='9')||text[p]=='-')) ++p;
  if(p==start||p>=text.size()||text[p++]!='=')return false;
  std::string key(text.substr(start,p-start-1));
  if(out.count(key))return false;
  bool quoted=p<text.size()&&text[p]=='"';
  if((key=="CODECS"||key=="SUPPLEMENTAL-CODECS")&&!quoted)return false;
  if((key=="VIDEO-RANGE"||key=="BANDWIDTH")&&quoted)return false;
  std::size_t end;
  if(quoted){++p;end=text.find('"',p);if(end==std::string::npos)return false;}
  else {end=text.find(',',p);if(end==std::string::npos)end=text.size();}
  auto value=text.substr(p,end-p);if(value.empty()||hasControlOrSpace(value))return false;
  out.emplace(std::move(key),std::string(value));p=end+(quoted?1:0);
  if(p<text.size()){if(text[p++]!=','||p==text.size())return false;}
 }
 auto it=out.find("BANDWIDTH");if(it==out.end()||it->second.empty()||it->second[0]=='0'||it->second.size()>15)return false;
 for(char c:it->second)if(c<'0'||c>'9')return false;
 return true;
}
inline std::vector<std::string> split(const std::string& s) {
 std::vector<std::string> result;std::size_t p=0;
 do {auto end=s.find(',',p);result.push_back(s.substr(p,end==std::string::npos?end:end-p));if(end==std::string::npos)break;p=end+1;}while(true);
 return result;
}
inline bool starts(const std::string& s,const char* prefix) {return s.rfind(prefix,0)==0;}
inline bool validHevcMain10(const std::string& codec) {
 std::vector<std::string> fields;std::size_t start=0;
 do {auto end=codec.find('.',start);fields.push_back(codec.substr(start,end==std::string::npos?end:end-start));if(end==std::string::npos)break;start=end+1;}while(true);
 if(fields.size()<4||fields.size()>10||(fields[0]!="hvc1"&&fields[0]!="hev1")||fields[1]!="2")return false;
 auto hex=[](const std::string& s,std::size_t max){if(s.empty()||s.size()>max)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;return true;};
 if(!hex(fields[2],8))return false;
 const auto& level=fields[3];
 if(level.size()<3||(level[0]!='L'&&level[0]!='H'))return false;
 static const char* levels[]={"30","60","63","90","93","120","123","126","150","153","156","180","183","186"};
 bool known=false;for(const char* x:levels)if(level.substr(1)==x)known=true;
 if(!known)return false;
 for(std::size_t i=4;i<fields.size();++i)if(!hex(fields[i],2))return false;
 return true;
}
inline bool matchesDv(const std::string& s,const char* prefix,const char* tail) {
 std::string expected(prefix);if(s.size()!=expected.size()+2+std::string(tail).size()||!starts(s,prefix))return false;
 // Levels beyond the currently evidenced range are unknown, never assumed valid.
 return s[expected.size()]=='0'&&s[expected.size()+1]>='1'&&s[expected.size()+1]<='9'&&s.substr(expected.size()+2)==tail;
}
inline void add(const std::map<std::string,std::string>& f,Summary& out) {
 auto get=[&](const char* k){auto i=f.find(k);return i==f.end()?std::string():i->second;};
 auto codecs=split(get("CODECS")), supplements=split(get("SUPPLEMENTAL-CODECS"));auto range=get("VIDEO-RANGE");
 bool otherDv=false,invalidHevc=false;unsigned hevc=0,five=0,eight1=0,eight4=0;
 for(const auto& c:codecs){if(starts(c,"hvc1.")||starts(c,"hev1.")){if(validHevcMain10(c))++hevc;else invalidHevc=true;}
  if(matchesDv(c,"dvh1.05.",""))++five;else if(starts(c,"dvh1.")||starts(c,"dvhe.")||starts(c,"dav1."))otherDv=true;}
 for(const auto& c:supplements){if(matchesDv(c,"dvh1.08.","/db1p"))++eight1;
  else if(matchesDv(c,"dvh1.08.","/db4h"))++eight4;
  else if(starts(c,"dvh1.")||starts(c,"dvhe.")||starts(c,"dav1."))otherDv=true;}
 ++out.variants;
 if(!otherDv&&!invalidHevc&&hevc==1&&!five&&eight1==1&&!eight4&&range=="PQ")++out.dv81;
 else if(!otherDv&&!invalidHevc&&hevc==1&&!five&&eight4==1&&!eight1&&range=="HLG")++out.dv84;
 else if(!otherDv&&!invalidHevc&&!hevc&&five==1&&!eight1&&!eight4&&range=="PQ")++out.dv5;
 else ++out.unknown;
}
inline Summary inspect(const std::string& input) {
 Summary invalid; if(input.size()>1024*1024)return invalid;
 std::size_t pos=0;bool header=false,pending=false;std::map<std::string,std::string> fields;Summary out;
 while(pos<input.size()){
  auto end=input.find('\n',pos);if(end==std::string::npos)end=input.size();auto line=input.substr(pos,end-pos);
  if(!line.empty()&&line.back()=='\r')line.pop_back();
  pos=end==input.size()?end:end+1;
  if(line.size()>8192)return invalid;
  for(unsigned char c:line)if(c<32||c==127)return invalid;
  if(!header){if(line!="#EXTM3U")return invalid;header=true;continue;}
  const std::string tag="#EXT-X-STREAM-INF:";
  if(line.substr(0,tag.size())==tag){if(pending||out.variants>=1024)return invalid;fields.clear();if(!attributes(line.substr(tag.size()),fields))return invalid;pending=true;}
  else if(pending&&line.substr(0,4)=="#EXT")return invalid;
  else if(!line.empty()&&line[0]!='#'&&pending){if(hasControlOrSpace(line))return invalid;add(fields,out);pending=false;}
 }
 if(!header||pending||!out.variants)return invalid;
 out.available=true;return out;
}
// The rewritten playlist contains only loopback URLs. They are retained in
// process memory for the active relay epoch, never returned or logged. An
// AVPlayer access-log URI may be mapped to the *last observed* variant only;
// it does not attest decoded Dolby Vision or guarantee no later ABR switch.
class BoundVariantLookup {
 std::map<std::string,std::string> routes_;
 std::set<std::string> seen_;
 std::size_t seenBytes_=0;
 bool disabled_=false;
 unsigned long long epoch_=0;
public:
 void clear(){routes_.clear();seen_.clear();seenBytes_=0;disabled_=false;epoch_=0;}
 void invalidateCurrent(){routes_.clear();epoch_=0;}
 void observe(unsigned long long incoming,unsigned long long current,bool root,bool rewritten,
              unsigned long long request,unsigned long long latest,const std::string& playlist) {
  if(!incoming||incoming!=current||!root||!rewritten)return;
  // AVPlayer can still consume a late master response even when a newer
  // request has been made. Never match any later event to a different master.
  if(!request||request!=latest){disabled_=true;invalidateCurrent();return;}
  invalidateCurrent();if(disabled_)return;
  // A rewritten master accepted by the relay but too complex for this
  // conservative parser may have been played. Forgetting its references
  // would allow a future response to misclassify an old access-log event.
  if(!inspect(playlist).available){disabled_=true;invalidateCurrent();return;}
  std::size_t pos=0;bool pending=false;std::map<std::string,std::string> fields;
  while(pos<playlist.size()){
   auto end=playlist.find('\n',pos);if(end==std::string::npos)end=playlist.size();
   auto line=playlist.substr(pos,end-pos);if(!line.empty()&&line.back()=='\r')line.pop_back();
   pos=end==playlist.size()?end:end+1;
   const std::string tag="#EXT-X-STREAM-INF:";
   if(line.substr(0,tag.size())==tag){fields.clear();if(!attributes(line.substr(tag.size()),fields)){disabled_=true;invalidateCurrent();return;}pending=true;}
   else if(pending&&!line.empty()&&line[0]!='#'){
    Summary one;add(fields,one);std::string mode="unknown";
    if(one.dv5==1)mode="5";else if(one.dv81==1)mode="8.1";else if(one.dv84==1)mode="8.4";
    const bool seenBefore=seen_.count(line)>0;
    if(!seenBefore){
     if(seen_.size()>=2048||line.size()>65536-seenBytes_){disabled_=true;invalidateCurrent();return;}
     seenBytes_+=line.size();seen_.insert(line);
    }
    auto result=routes_.emplace(line,seenBefore?"unknown":mode);
    if(!result.second)result.first->second="unknown";
    pending=false;
   }
  }
  epoch_=incoming;
 }
 std::string lastObserved(unsigned long long current,const std::string& uri) const {
  if(!current||current!=epoch_||uri.empty()||uri.size()>8192)return "unknown";
  const auto it=routes_.find(uri);return it==routes_.end()?"unknown":it->second;
 }
};
// Relay epochs are invalidated on every stop/restart. An old reply, non-root
// playlist or rejected rewrite can never create evidence for a new session.
class BoundSummary {
 Summary value_;
 unsigned long long epoch_=0;
public:
 void clear(){value_={};epoch_=0;}
 void observe(unsigned long long incoming,unsigned long long current,bool root,bool rewritten,
              unsigned long long request,unsigned long long latest,const std::string& body) {
  if(!incoming||incoming!=current||!root||!rewritten||!request||request!=latest)return;
  value_=inspect(body);epoch_=incoming;
 }
 Summary read(unsigned long long current) const {
  return current&&current==epoch_?value_:Summary{};
 }
};
}
