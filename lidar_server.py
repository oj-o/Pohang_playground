import asyncio
import websockets
import serial
import json
import time
import math # Added for math.radians, math.cos, math.sin, math.sqrt

# Configuration
LIDAR_PORT = 'COM5' # YDLidar X4 Pro가 연결된 COM 포트
LIDAR_BAUDRATE = 115200 # YDLidar X4 Pro의 기본 보드레이트
WEBSOCKET_PORT = 8765

async def lidar_reader(websocket):
    """LIDAR에서 데이터를 읽고 가장 가까운 거리를 WebSocket을 통해 전송합니다."""
    ser = None
    try:
        print(f"LIDAR 포트 {LIDAR_PORT}에 연결 시도 중...")
        ser = serial.Serial(LIDAR_PORT, LIDAR_BAUDRATE, timeout=1)
        print(f"LIDAR 포트 {LIDAR_PORT}에 연결되었습니다.")


        # 클러스터링을 위한 임계값 (예: 0.2m 이내의 점들은 같은 객체로 간주)
        CLUSTER_THRESHOLD = 0.2 # meters

        while True:
            # --- 실제 라이다 데이터 읽기 (이 부분은 YDLidar 프로토콜에 맞춰 구현해야 함) ---
            # YDLidar X4 Pro는 연속적으로 스캔 데이터를 전송합니다.
            # 여기서는 시리얼 버퍼에서 데이터를 읽고 파싱 함수로 전달합니다.
            
            # 주의: 이 부분은 매우 중요하며, YDLidar X4 Pro의 정확한 프로토콜에 따라
            # 패킷 동기화, 체크섬 검증, 데이터 추출 로직이 들어가야 합니다.
            # ser.read()는 지정된 바이트 수만큼 읽거나 타임아웃됩니다.
            # 실제로는 패킷의 시작 바이트를 찾고, 패킷 길이를 읽어 전체 패킷을 읽는 방식이 필요합니다.
            
            raw_bytes = ser.read(1024) # 일단 1024바이트를 읽어 시도 (실제로는 패킷 단위로 읽어야 함)
            
            if raw_bytes:
                scan_data = parse_lidar_data(raw_bytes) # 실제 파싱 함수 호출
            else:
                scan_data = [] # 데이터가 없으면 빈 리스트

            # --- 기본적인 클러스터링 및 객체 위치 추정 ---
            detected_objects = []
            
            # 스캔 데이터를 Cartesian 좌표로 변환 (x, y)
            # 라이다는 보통 (0,0)에 위치한다고 가정
            cartesian_points = []
            for angle_deg, dist_m in scan_data: # Use scan_data here
                angle_rad = math.radians(angle_deg)
                x = dist_m * math.cos(angle_rad)
                y = dist_m * math.sin(angle_rad)
                cartesian_points.append({'x': x, 'y': y})

            # 간단한 클러스터링 (인접한 점들을 그룹화)
            # 이 부분은 매우 기본적인 예시이며, 실제 환경에서는 DBSCAN 등 더 견고한 알고리즘이 필요합니다.
            if cartesian_points:
                clusters = []
                # 첫 번째 점으로 첫 클러스터 시작
                clusters.append([cartesian_points[0]])
                
                for i in range(1, len(cartesian_points)):
                    current_point = cartesian_points[i]
                    added_to_cluster = False
                    for cluster in clusters:
                        # 현재 점이 기존 클러스터의 어떤 점과도 가까우면 해당 클러스터에 추가
                        for existing_point in cluster:
                            distance = math.sqrt((current_point['x'] - existing_point['x'])**2 + (current_point['y'] - existing_point['y'])**2)
                            if distance < CLUSTER_THRESHOLD:
                                cluster.append(current_point)
                                added_to_cluster = True
                                break # 이 클러스터에 추가했으니 다음 점으로
                        if added_to_cluster:
                            break # 이 점을 클러스터에 추가했으니 다음 점으로
                    
                    if not added_to_cluster:
                        # 어떤 클러스터에도 추가되지 않았으면 새 클러스터 생성
                        clusters.append([current_point])
                
                # 각 클러스터의 중심(평균) 계산
                for cluster in clusters:
                    if cluster:
                        avg_x = sum(p['x'] for p in cluster) / len(cluster)
                        avg_y = sum(p['y'] for p in cluster) / len(cluster)
                        detected_objects.append({'x': round(avg_x, 2), 'y': round(avg_y, 2)})
            # --- 클러스터링 끝 ---

            data = {
                "type": "lidar_player_positions",
                "players": detected_objects
            }
            await websocket.send(json.dumps(data))
            await asyncio.sleep(0.1) # 100ms마다 데이터 전송

    except serial.SerialException as e:
        print(f"시리얼 포트 오류: {e}")
        await websocket.send(json.dumps({"type": "error", "message": f"LIDAR 연결 오류: {e}"}))
    except Exception as e:
        print(f"예상치 못한 오류 발생: {e}")
        await websocket.send(json.dumps({"type": "error", "message": f"서버 오류: {e}"}))
    finally:
        if ser and ser.is_open:
            ser.close()
            print(f"LIDAR 포트 {LIDAR_PORT} 연결이 종료되었습니다.")

async def main():
    async with websockets.serve(lidar_reader, "localhost", WEBSOCKET_PORT):
        print(f"WebSocket 서버가 ws://localhost:{WEBSOCKET_PORT}에서 시작되었습니다.")
        await asyncio.Future() # 서버를 계속 실행

def test_lidar_connection():
    """Tests the connection to the LIDAR sensor."""
    try:
        with serial.Serial(LIDAR_PORT, LIDAR_BAUDRATE, timeout=1) as ser:
            print(f"LIDAR 포트 {LIDAR_PORT}에 성공적으로 연결되었습니다.")
            # Optionally, try to read a byte to confirm data flow
            # data = ser.read(1)
            # if data:
            #     print("LIDAR에서 데이터를 수신했습니다. 연결이 양호합니다.")
            # else:
            #     print("LIDAR에 연결되었지만 데이터를 수신하지 못했습니다. 센서가 작동 중인지 확인하세요.")
            return True, "LIDAR 센서 연결이 양호합니다."
    except serial.SerialException as e:
        return False, f"LIDAR 연결 오류: {e}. 포트가 올바른지, 센서가 켜져 있는지 확인하세요."
    except Exception as e:
        return False, f"예상치 못한 오류: {e}"

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        success, message = test_lidar_connection()
        print(message)
        sys.exit(0 if success else 1)
    else:
        asyncio.run(main())
