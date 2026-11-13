cmake_minimum_required(VERSION 3.10...3.31)

set(CMAKE_AUTOMOC ON)

find_package(Qt6 ${REQUIRED_QT_VERSION} REQUIRED COMPONENTS Test)

set(TEST_INCLUDE_DIRS
  ${CMAKE_SOURCE_DIR}/src
  ${CMAKE_SOURCE_DIR}/src/core
  ${CMAKE_SOURCE_DIR}/src/shared
  ${CMAKE_SOURCE_DIR}/external
  ${CMAKE_SOURCE_DIR}/src/player
)

set(TEST_COMPILE_DEFS
  PREFIX="${CMAKE_INSTALL_PREFIX}"
)

add_executable(test_systemcomponent test_systemcomponent.cpp)
target_link_libraries(test_systemcomponent jmp_core Qt6::Test)
target_include_directories(test_systemcomponent PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_systemcomponent PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_systemcomponent COMMAND test_systemcomponent)

add_executable(test_log test_log.cpp)
target_link_libraries(test_log jmp_core Qt6::Test)
target_include_directories(test_log PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_log PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_log COMMAND test_log)

add_executable(test_settings test_settings.cpp)
target_link_libraries(test_settings jmp_core Qt6::Test)
target_include_directories(test_settings PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_settings PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_settings COMMAND test_settings)

add_executable(test_displaymanager test_displaymanager.cpp)
target_link_libraries(test_displaymanager jmp_core Qt6::Test)
target_include_directories(test_displaymanager PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_displaymanager PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_displaymanager COMMAND test_displaymanager)

find_program(DEEPSTREAM_NODE_EXECUTABLE NAMES node)
if(DEEPSTREAM_NODE_EXECUTABLE)
  foreach(script deepstream-inputPlugin deepstream-audio-engine deepstream-audio-player deepstream-settings-dialog deepstream-audio-details deepstream-branding deepstream-locale deepstream-video-details deepstream-artwork deepstream-early-details deepstream-artwork-cache deepstream-update-plugin deepstream-enhancement-store deepstream-audio-enhancements spatial-audio-control log-redaction-review two-phase)
    add_test(NAME ${script} COMMAND ${DEEPSTREAM_NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/${script}.test.js)
    set_tests_properties(${script} PROPERTIES WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
  endforeach()
endif()

find_program(DEEPSTREAM_FFMPEG_EXECUTABLE NAMES ffmpeg)
find_program(DEEPSTREAM_PYTHON_EXECUTABLE NAMES python3)
if(DEEPSTREAM_FFMPEG_EXECUTABLE AND DEEPSTREAM_PYTHON_EXECUTABLE)
  add_test(NAME deepstream-dsp-limiter COMMAND ${DEEPSTREAM_PYTHON_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/deepstream_dsp_limiter.py --ffmpeg ${DEEPSTREAM_FFMPEG_EXECUTABLE} --source ${CMAKE_SOURCE_DIR})
endif()

# FBO depth selection uses actual GL channel sizes and must preserve bindings.
add_executable(test_framebufferformatprobe test_framebufferformatprobe.cpp)
target_compile_features(test_framebufferformatprobe PRIVATE cxx_std_17)
target_include_directories(test_framebufferformatprobe PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_framebufferformatprobe COMMAND test_framebufferformatprobe)

if(APPLE)
  find_library(DEEPSTREAM_OPENGL_FRAMEWORK OpenGL)
  if(NOT DEEPSTREAM_OPENGL_FRAMEWORK)
    message(FATAL_ERROR "OpenGL framework is required for the CGL regression")
  endif()
  add_executable(test_framebuffergl_cgl test_framebuffergl_cgl.cpp)
  target_compile_features(test_framebuffergl_cgl PRIVATE cxx_std_17)
  target_include_directories(test_framebuffergl_cgl PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
  target_compile_options(test_framebuffergl_cgl PRIVATE -Wno-deprecated-declarations)
  target_link_libraries(test_framebuffergl_cgl ${DEEPSTREAM_OPENGL_FRAMEWORK})
  add_test(NAME test_framebuffergl_cgl COMMAND test_framebuffergl_cgl)
  set_tests_properties(test_framebuffergl_cgl PROPERTIES SKIP_RETURN_CODE 77)
endif()

add_executable(test_audioenhancementsession test_audioenhancementsession.cpp)
target_include_directories(test_audioenhancementsession PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_audioenhancementsession COMMAND test_audioenhancementsession)

add_executable(test_local_media_gate test_local_media_gate.cpp)
target_include_directories(test_local_media_gate PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_local_media_gate COMMAND test_local_media_gate)
add_executable(test_local_cancel test_local_cancel.cpp)
target_compile_features(test_local_cancel PRIVATE cxx_std_17)
target_include_directories(test_local_cancel PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_local_cancel COMMAND test_local_cancel)
add_executable(test_mpv_load_evidence test_mpv_load_evidence.cpp)
target_include_directories(test_mpv_load_evidence PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_mpv_load_evidence COMMAND test_mpv_load_evidence)
add_executable(test_local_drop_gate test_local_drop_gate.cpp)
target_include_directories(test_local_drop_gate PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_local_drop_gate COMMAND test_local_drop_gate)

add_executable(test_audiofilterguard test_audiofilterguard.cpp)
target_include_directories(test_audiofilterguard PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
target_link_libraries(test_audiofilterguard Qt6::Core)
add_test(NAME test_audiofilterguard COMMAND test_audiofilterguard)

add_executable(test_experimentalbackendcoordinator test_experimentalbackendcoordinator.cpp)
target_include_directories(test_experimentalbackendcoordinator PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_experimentalbackendcoordinator COMMAND test_experimentalbackendcoordinator)

add_executable(test_deferredloadgate test_deferredloadgate.cpp)
target_compile_features(test_deferredloadgate PRIVATE cxx_std_17)
target_include_directories(test_deferredloadgate PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
add_test(NAME test_deferredloadgate COMMAND test_deferredloadgate)

add_executable(test_avsignalpath test_avsignalpath.cpp)
target_include_directories(test_avsignalpath PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
target_link_libraries(test_avsignalpath Qt6::Core)
add_test(NAME test_avsignalpath COMMAND test_avsignalpath)

if(APPLE AND DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  add_executable(test_hls_origin_policy test_hls_origin_policy.cpp)
  target_include_directories(test_hls_origin_policy PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
  target_link_libraries(test_hls_origin_policy Qt6::Core Qt6::Network)
  add_test(NAME test_hls_origin_policy COMMAND test_hls_origin_policy)
  add_executable(test_hls_session_relay test_hls_session_relay.cpp ${CMAKE_SOURCE_DIR}/src/player/HlsSessionRelay.cpp ${CMAKE_SOURCE_DIR}/src/player/HlsSessionRelay.h)
  target_include_directories(test_hls_session_relay PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
  target_link_libraries(test_hls_session_relay Qt6::Core Qt6::Network)
  add_test(NAME test_hls_session_relay COMMAND test_hls_session_relay)
  add_executable(test_native_hls_session test_native_hls_session.cpp ${CMAKE_SOURCE_DIR}/src/player/NativeHlsSession.cpp ${CMAKE_SOURCE_DIR}/src/player/NativeHlsSession.h)
  target_include_directories(test_native_hls_session PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
  target_link_libraries(test_native_hls_session Qt6::Core Qt6::Network)
  add_test(NAME test_native_hls_session COMMAND test_native_hls_session)
endif()

if(APPLE AND DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  add_executable(test_native_audio_hls_route test_native_audio_hls_route.cpp)
  target_include_directories(test_native_audio_hls_route PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
  target_link_libraries(test_native_audio_hls_route Qt6::Core)
  add_test(NAME test_native_audio_hls_route COMMAND test_native_audio_hls_route)
endif()

if(APPLE AND DEEPSTREAM_HLS_CONTROLLED_MPV_TEST)
  add_executable(test_mpvstopfence test_mpvstopfence.cpp)
  target_compile_features(test_mpvstopfence PRIVATE cxx_std_17)
  target_include_directories(test_mpvstopfence PRIVATE ${CMAKE_SOURCE_DIR}/src/player)
  add_test(NAME test_mpvstopfence COMMAND test_mpvstopfence)
endif()
