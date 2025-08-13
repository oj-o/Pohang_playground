import asyncio
import websockets
import serial
import json
import time

# Configuration
LIDAR_PORT = 'COM3' # YDLidar X4 Pro가 연결된 COM 포트
LIDAR_BAUDRATE = 115200 # YDLidar X4 Pro의 기본 보드레이트
WEBSOCKET_PORT = 8765

async def lidar_reader(websocket):
    """LIDAR에서 데이터를 읽고 가장 가까운 거리를 WebSocket을 통해 전송합니다."""
    ser = None
    try:
        print(f"LIDAR 포트 {LIDAR_PORT}에 연결 시도 중...")
        ser = serial.Serial(LIDAR_PORT, LIDAR_BAUDRATE, timeout=1)
        print(f"LIDAR 포트 {LIDAR_PORT}에 연결되었습니다.")

        # YDLidar X4 Pro 데이터 파싱 로직 (플레이스홀더)
        # 실제 YDLidar X4 Pro는 특정 프로토콜(예: A1/A2/A3 시리즈의 RPLIDAR 프로토콜과 유사)을 따릅니다.
        # 여기서는 간단한 시뮬레이션 데이터를 전송합니다.
        # 실제 구현 시에는 YDLidar SDK 또는 관련 라이브러리를 사용하여 데이터를 파싱해야 합니다.
        # 예: https://github.com/SkoltechRobotics/rplidar/blob/master/rplidar.py 참고

        while True:
            # 실제 라이다 데이터 파싱 및 가장 가까운 거리 추출 로직이 들어갈 곳
            # 현재는 0.5m에서 1.5m 사이의 시뮬레이션 거리 데이터를 전송합니다.
            min_distance = 0.5 + (time.time() % 10) * 0.1 # 0.5m ~ 1.4m 사이

            data = {
                "type": "lidar_closest_distance",
                "distance_m": round(min_distance, 2)
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
